from __future__ import annotations

import re
from datetime import datetime, timezone

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...scan_engine import detect_kind


_SUFFIX_STRIP = (
    "_consommation_actuelle",
    "_puissance",
    "_power",
    "_w",
    "_watts",
)


def derive_base_slug(power_entity_id: str) -> str:
    """Derive base sensor slug from a power sensor entity_id.

    Example:
      sensor.chambre_alex_pc_consommation_actuelle -> chambre_alex_pc

    Raises ValueError if entity_id invalid or base cannot be derived.
    """
    if not isinstance(power_entity_id, str) or "." not in power_entity_id:
        raise ValueError("invalid_entity_id")

    domain, obj = power_entity_id.split(".", 1)
    if domain != "sensor" or not obj:
        raise ValueError("invalid_entity_id")

    base = obj
    for suf in _SUFFIX_STRIP:
        if base.endswith(suf):
            base = base[: -len(suf)]
            break

    base = re.sub(r"_+$", "", base)
    if not base:
        raise ValueError("cannot_derive_base")

    return base


class EnrichPreviewView(HomeAssistantView):
    url = f"{API_PREFIX}/enrich/preview"
    name = "hse:unified:enrich_preview"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]

        user = request.get("hass_user")
        if not user or not getattr(user, "is_admin", False):
            return self.json({"error": "admin_required"}, status_code=403)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        # Default behavior: work on current pricing selection for a "one click" UX.
        entity_ids = body.get("entity_ids")
        if not isinstance(entity_ids, list) or not entity_ids:
            cat = hass.data.get(DOMAIN, {}).get("catalogue") or {}
            settings = cat.get("settings") if isinstance(cat, dict) else {}
            pricing = settings.get("pricing") if isinstance(settings, dict) else {}
            cids = pricing.get("cost_entity_ids") if isinstance(pricing, dict) else []
            entity_ids = [x for x in cids if isinstance(x, str) and x]

        decisions_required: list[dict] = []
        errors: list[dict] = []

        to_create: list[str] = []
        already_ok: list[str] = []

        per_source: list[dict] = []

        for eid in entity_ids:
            st = hass.states.get(eid)
            attrs = st.attributes if st else {}
            unit = (attrs or {}).get("unit_of_measurement")
            device_class = (attrs or {}).get("device_class")
            kind = detect_kind(device_class, unit)

            if kind != "power":
                decisions_required.append({"code": "not_power", "reason": "skip", "entity_id": eid, "kind": kind})
                continue

            try:
                base = derive_base_slug(eid)
            except Exception as exc:  # noqa: BLE001
                base = None
                decisions_required.append({"code": "base_slug", "reason": str(exc), "power_entity_id": eid})

            expected = []
            if base:
                expected = [
                    f"sensor.{base}_kwh_total",
                    f"sensor.{base}_kwh_day",
                    f"sensor.{base}_kwh_week",
                    f"sensor.{base}_kwh_month",
                    f"sensor.{base}_kwh_year",
                ]

            created_now = []
            ok_now = []
            for x in expected:
                if hass.states.get(x) is not None:
                    ok_now.append(x)
                    if x not in already_ok:
                        already_ok.append(x)
                else:
                    created_now.append(x)
                    if x not in to_create:
                        to_create.append(x)

            per_source.append({"power_entity_id": eid, "base": base, "expected": expected, "already_ok": ok_now, "to_create": created_now})

        return self.json(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "input": {"entity_ids": entity_ids},
                "summary": {
                    "to_create_count": len(to_create),
                    "already_ok_count": len(already_ok),
                    "errors_count": len(errors),
                    "decisions_required_count": len(decisions_required),
                },
                "per_source": per_source,
                "to_create": to_create,
                "already_ok": already_ok,
                "decisions_required": decisions_required,
                "errors": errors,
            }
        )
