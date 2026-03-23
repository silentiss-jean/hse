"""Apply meta sync pending diff.

This mutates the meta store (rooms/types/assignments) only when user validates.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...meta_sync import apply_pending_diff
from ...time_utils import utc_now_iso


class MetaSyncApplyView(HomeAssistantView):
    url = f"{API_PREFIX}/meta/sync/apply"
    name = "hse:unified:meta_sync_apply"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})

        meta_store = domain_data.get("meta")
        if not isinstance(meta_store, dict):
            return self.json({"ok": False, "error": "meta:not_ready"}, status_code=503)

        sync = meta_store.get("sync") if isinstance(meta_store.get("sync"), dict) else {}
        pending = sync.get("pending_diff")
        if not isinstance(pending, dict) or not pending.get("has_changes"):
            return self.json({"ok": False, "error": "meta_sync:no_pending"}, status_code=409)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        apply_mode = "auto"
        if isinstance(body, dict) and body.get("apply_mode") in ("auto", "all"):
            apply_mode = body.get("apply_mode")

        apply_pending_diff(meta_store, pending, apply_mode=apply_mode)

        meta = meta_store.get("meta") if isinstance(meta_store.get("meta"), dict) else None
        if isinstance(meta, dict):
            meta["updated_at"] = utc_now_iso()

        meta_store["generated_at"] = utc_now_iso()
        sync["pending_diff"] = None
        sync["pending_generated_at"] = None
        meta_store["sync"] = sync

        saver = domain_data.get("meta_save")
        if saver:
            await saver()

        return self.json({"ok": True, "meta_store": meta_store})
