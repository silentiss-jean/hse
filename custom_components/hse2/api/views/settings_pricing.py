"""Settings endpoints for pricing / contract configuration.

HSE_DOC: custom_components/hse/docs/pricing_settings.md

This stores user-supplied pricing in the persistent catalogue under:

- cat["settings"]["pricing"]

We explicitly store both HT and TTC values; we never infer VAT.

Extensions:
- pricing["cost_entity_ids"]: list[str] of HA entity_ids used for cost calculation.

Guardrails:
- The reference total entity (catalogue enrichment is_reference_total) cannot be part of cost_entity_ids.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...time_utils import utc_now_iso


_TIME_RE = re.compile(r"^(?P<h>\d{2}):(?P<m>\d{2})$")
_ENTITY_ID_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


def _parse_time_hhmm(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("time:invalid")
    m = _TIME_RE.match(value.strip())
    if not m:
        raise ValueError("time:invalid")
    h = int(m.group("h"))
    mm = int(m.group("m"))
    if h < 0 or h > 23 or mm < 0 or mm > 59:
        raise ValueError("time:invalid")
    return f"{h:02d}:{mm:02d}"


def _parse_price_pair(obj: Any, field: str) -> dict[str, float]:
    if not isinstance(obj, dict):
        raise ValueError(f"{field}:invalid")

    def _num(v: Any, key: str) -> float:
        if v is None or v == "":
            raise ValueError(f"{field}.{key}:required")
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"{field}.{key}:invalid")
        if f < 0:
            raise ValueError(f"{field}.{key}:negative")
        return f

    return {"ht": _num(obj.get("ht"), "ht"), "ttc": _num(obj.get("ttc"), "ttc")}


def _parse_entity_id_list(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field}:invalid")

    out: list[str] = []
    for raw in value:
        if not isinstance(raw, str):
            raise ValueError(f"{field}:invalid")
        eid = raw.strip()
        if not eid:
            continue
        if not _ENTITY_ID_RE.match(eid):
            raise ValueError(f"{field}:invalid")
        if eid not in out:
            out.append(eid)
    return out


def _current_reference_entity_id(cat: Any) -> str | None:
    if not isinstance(cat, dict):
        return None
    items = cat.get("items")
    if not isinstance(items, dict):
        return None
    for it in items.values():
        if not isinstance(it, dict):
            continue
        enr = it.get("enrichment")
        if not isinstance(enr, dict):
            continue
        if enr.get("is_reference_total") is True:
            src = it.get("source")
            if isinstance(src, dict):
                eid = src.get("entity_id")
                if isinstance(eid, str) and eid:
                    return eid
    return None


class SettingsPricingView(HomeAssistantView):
    """Get/set pricing settings (contract type, HT/TTC prices, subscription, HPHC schedule)."""

    url = f"{API_PREFIX}/settings/pricing"
    name = "hse:unified:settings_pricing"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})
        cat = domain_data.get("catalogue")
        if not cat:
            return self.json({"ok": False, "error": "catalogue:not_ready"}, status_code=503)

        settings = cat.get("settings") if isinstance(cat, dict) else None
        pricing = settings.get("pricing") if isinstance(settings, dict) else None

        # Default contract values (user suggested, consistent for fixed and HP/HC).
        defaults = {
            "contract_type": "fixed",
            "display_mode": "ttc",
            "subscription_monthly": {"ht": 13.79, "ttc": 19.79},
            "fixed_energy_per_kwh": {"ht": 0.1327, "ttc": 0.1952},
            "hp_energy_per_kwh": {"ht": 0.1327, "ttc": 0.1952},
            "hc_energy_per_kwh": {"ht": 0.1327, "ttc": 0.1952},
            "hc_schedule": {"start": "22:00", "end": "06:00"},
            "cost_entity_ids": [],
        }

        return self.json({"ok": True, "pricing": pricing, "defaults": defaults})

    async def post(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})
        cat = domain_data.get("catalogue")
        if not cat:
            return self.json({"ok": False, "error": "catalogue:not_ready"}, status_code=503)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        if body.get("clear") is True or body.get("pricing") is None:
            if isinstance(cat, dict):
                settings = cat.setdefault("settings", {})
                if isinstance(settings, dict):
                    settings.pop("pricing", None)
                cat["generated_at"] = utc_now_iso()
                saver = domain_data.get("catalogue_save")
                if saver:
                    await saver()
            return self.json({"ok": True, "cleared": True})

        pricing_in = body.get("pricing") if "pricing" in body else body
        if not isinstance(pricing_in, dict):
            return self.json({"ok": False, "error": "pricing:invalid"}, status_code=400)

        try:
            contract_type = pricing_in.get("contract_type")
            if contract_type not in ("fixed", "hphc"):
                raise ValueError("contract_type:invalid")

            display_mode = pricing_in.get("display_mode")
            if display_mode not in ("ttc", "ht"):
                raise ValueError("display_mode:invalid")

            subscription_monthly = _parse_price_pair(pricing_in.get("subscription_monthly"), "subscription_monthly")
            cost_entity_ids = _parse_entity_id_list(pricing_in.get("cost_entity_ids"), "cost_entity_ids")

            ref_eid = _current_reference_entity_id(cat)
            if ref_eid and ref_eid in cost_entity_ids:
                raise ValueError("cost_entity_ids:contains_reference_total")

            out: dict[str, Any] = {
                "contract_type": contract_type,
                "display_mode": display_mode,
                "subscription_monthly": subscription_monthly,
                "cost_entity_ids": cost_entity_ids,
                "updated_at": utc_now_iso(),
            }

            if contract_type == "fixed":
                out["fixed_energy_per_kwh"] = _parse_price_pair(
                    pricing_in.get("fixed_energy_per_kwh"),
                    "fixed_energy_per_kwh",
                )
            else:
                out["hp_energy_per_kwh"] = _parse_price_pair(
                    pricing_in.get("hp_energy_per_kwh"),
                    "hp_energy_per_kwh",
                )
                out["hc_energy_per_kwh"] = _parse_price_pair(
                    pricing_in.get("hc_energy_per_kwh"),
                    "hc_energy_per_kwh",
                )
                sched = pricing_in.get("hc_schedule")
                if not isinstance(sched, dict):
                    raise ValueError("hc_schedule:invalid")
                start = _parse_time_hhmm(sched.get("start"))
                end = _parse_time_hhmm(sched.get("end"))
                if start == end:
                    raise ValueError("hc_schedule:degenerate")
                out["hc_schedule"] = {"start": start, "end": end}

        except ValueError as e:
            return self.json({"ok": False, "error": str(e)}, status_code=400)

        settings = cat.setdefault("settings", {})
        if not isinstance(settings, dict):
            return self.json({"ok": False, "error": "catalogue:settings_invalid"}, status_code=500)
        settings["pricing"] = out

        cat["generated_at"] = utc_now_iso()

        saver = domain_data.get("catalogue_save")
        if saver:
            await saver()

        return self.json({"ok": True, "pricing": out})
