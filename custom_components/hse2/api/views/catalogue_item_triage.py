"""HSE_DOC: custom_components/hse/docs/persistent_catalogue.md
HSE_MAINTENANCE: If you add/rename item triage actions, update the doc above.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...time_utils import utc_now_iso


class CatalogueItemTriageView(HomeAssistantView):
    url = f"{API_PREFIX}/catalogue/item/{{item_id}}/triage"
    name = "hse:unified:catalogue_item_triage"
    requires_auth = True

    async def post(self, request, item_id: str):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})
        cat = domain_data.get("catalogue")
        if not cat:
            return self.json({"ok": False, "error": "catalogue:not_ready"}, status_code=503)

        body = await request.json()
        triage = body.get("triage") or {}

        item = (cat.get("items") or {}).get(item_id)
        if not isinstance(item, dict):
            return self.json({"ok": False, "error": "item:not_found"}, status_code=404)

        item_triage = item.setdefault("triage", {})
        if "policy" in triage:
            item_triage["policy"] = triage.get("policy")
        if "mute_until" in triage:
            item_triage["mute_until"] = triage.get("mute_until")
        if "note" in triage:
            item_triage["note"] = triage.get("note")

        item_triage["updated_at"] = utc_now_iso()

        # Persist immediately
        saver = domain_data.get("catalogue_save")
        if saver:
            await saver()

        return self.json({"ok": True, "item_id": item_id, "triage": item_triage})
