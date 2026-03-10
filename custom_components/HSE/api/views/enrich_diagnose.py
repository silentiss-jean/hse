from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er

from ...const import API_PREFIX, DOMAIN
from ...scan_engine import detect_kind
from .enrich_preview import derive_base_slug


def _admin_only(request) -> bool:
    user = request.get("hass_user")
    return bool(user and getattr(user, "is_admin", False))


def _as_float_state(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    if not s or s in ("unknown", "unavailable", "none", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _has_config_entry_named(hass, *, domain: str, name: str) -> bool:
    try:
        entries = hass.config_entries.async_entries(domain)
    except Exception:  # noqa: BLE001
        return False

    for e in entries or []:
        try:
            if (e.title or "") == name:
                return True
            opts = getattr(e, "options", None) or {}
            if isinstance(opts, dict) and opts.get("name") == name:
                return True
        except Exception:  # noqa: BLE001
            continue

    return False


class EnrichDiagnoseView(HomeAssistantView):
    url = f"{API_PREFIX}/enrich/diagnose"
    name = "hse:unified:enrich_diagnose"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]

        if not _admin_only(request):
            return self.json({"error": "admin_required"}, status_code=403)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        entity_ids = body.get("entity_ids")
        if not isinstance(entity_ids, list) or not entity_ids:
            cat = hass.data.get(DOMAIN, {}).get("catalogue") or {}
            settings = cat.get("settings") if isinstance(cat, dict) else {}
            pricing = settings.get("pricing") if isinstance(settings, dict) else {}
            cids = pricing.get("cost_entity_ids") if isinstance(pricing, dict) else []
            entity_ids = [x for x in cids if isinstance(x, str) and x]

        ent_reg = er.async_get(hass)

        bases: dict[str, dict] = {}

        for eid in entity_ids:
            st = hass.states.get(eid)
            attrs = st.attributes if st else {}
            unit = (attrs or {}).get("unit_of_measurement")
            device_class = (attrs or {}).get("device_class")
            kind = detect_kind(device_class, unit)
            if kind != "power":
                continue

            try:
                base = derive_base_slug(eid)
            except Exception:  # noqa: BLE001
                continue

            bases[base] = {"base": base, "power_entity_id": eid}

        per_base = []

        for base in sorted(bases.keys()):
            power_eid = bases[base]["power_entity_id"]
            power_state = hass.states.get(power_eid)
            power_attrs = power_state.attributes if power_state else {}

            total_name = f"{base}_kwh_total"
            total_eid = f"sensor.{total_name}"
            total_state = hass.states.get(total_eid)
            total_attrs = total_state.attributes if total_state else {}

            meters = []
            for suf, cycle in (("day", "daily"), ("week", "weekly"), ("month", "monthly"), ("year", "yearly")):
                meter_name = f"{base}_kwh_{suf}"
                meter_eid = f"sensor.{meter_name}"
                ms = hass.states.get(meter_eid)
                meters.append(
                    {
                        "cycle": cycle,
                        "name": meter_name,
                        "entity_id": meter_eid,
                        "state": ms.state if ms else None,
                        "exists": bool(ms or ent_reg.async_get(meter_eid)),
                        "config_entry_exists": _has_config_entry_named(hass, domain="utility_meter", name=meter_name),
                    }
                )

            ready = {
                "power_numeric": _as_float_state(power_state.state if power_state else None) is not None,
                "total_numeric": _as_float_state(total_state.state if total_state else None) is not None,
            }

            hints = []
            if not ready["power_numeric"]:
                hints.append("Puissance: unknown/unavailable → attendre une mesure puis relancer")
            if power_state and (power_attrs or {}).get("unit_of_measurement") not in ("W", "kW"):
                hints.append("Puissance: unité attendue W/kW")
            if not ready["total_numeric"]:
                hints.append("kWh total: encore unknown → l'Integral n'a pas encore reçu de delta")

            per_base.append(
                {
                    "base": base,
                    "power": {
                        "entity_id": power_eid,
                        "state": power_state.state if power_state else None,
                        "unit": (power_attrs or {}).get("unit_of_measurement"),
                        "device_class": (power_attrs or {}).get("device_class"),
                        "exists": bool(power_state or ent_reg.async_get(power_eid)),
                        "config_ok": kind == "power",
                    },
                    "total": {
                        "name": total_name,
                        "entity_id": total_eid,
                        "state": total_state.state if total_state else None,
                        "unit": (total_attrs or {}).get("unit_of_measurement"),
                        "device_class": (total_attrs or {}).get("device_class"),
                        "exists": bool(total_state or ent_reg.async_get(total_eid)),
                        "config_entry_exists": _has_config_entry_named(hass, domain="integration", name=total_name),
                    },
                    "meters": meters,
                    "ready": ready,
                    "hints": hints,
                }
            )

        return self.json(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "input": {"entity_ids": entity_ids},
                "bases": per_base,
            }
        )
