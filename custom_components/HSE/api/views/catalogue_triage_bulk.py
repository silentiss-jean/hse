"""HSE_DOC: custom_components/hse/docs/unified_api.md
HSE_MAINTENANCE: Bulk operations must remain safe and idempotent.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...time_utils import utc_now_iso


class CatalogueTriageBulkView(HomeAssistantView):
    url = f"{API_PREFIX}/catalogue/triage/bulk"
    name = "hse:unified:catalogue_triage_bulk"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})
        cat = domain_data.get("catalogue")
        if not cat:
            return self.json({"ok": False, "error": "catalogue:not_ready"}, status_code=503)

        body = await request.json()
        item_ids = body.get("item_ids") or []
        triage = body.get("triage") or {}

        if not isinstance(item_ids, list) or not item_ids:
            return self.json({"ok": False, "error": "bulk:item_ids_required"}, status_code=400)
        if not isinstance(triage, dict) or not triage:
            return self.json({"ok": False, "error": "bulk:triage_required"}, status_code=400)

        items = cat.get("items") or {}
        updated = []
        skipped = []
        now_iso = utc_now_iso()

        for item_id in item_ids:
            item = items.get(item_id)
            if not isinstance(item, dict):
                skipped.append({"item_id": item_id, "reason": "not_found"})
                continue

            item_triage = item.setdefault("triage", {})
            if "policy" in triage:
                item_triage["policy"] = triage.get("policy")
            if "mute_until" in triage:
                item_triage["mute_until"] = triage.get("mute_until")
            if "note" in triage:
                item_triage["note"] = triage.get("note")

            item_triage["updated_at"] = now_iso
            updated.append(item_id)

        saver = domain_data.get("catalogue_save")
        if saver:
            await saver()

        return self.json({"ok": True, "updated": updated, "skipped": skipped})
