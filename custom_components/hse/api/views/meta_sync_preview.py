"""Compute meta sync diff (preview).

Workflow: auto-propose -> user saves/validates (apply).
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN


class MetaSyncPreviewView(HomeAssistantView):
    url = f"{API_PREFIX}/meta/sync/preview"
    name = "hse:unified:meta_sync_preview"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})

        tick = domain_data.get("meta_sync_tick")
        if not tick:
            return self.json({"ok": False, "error": "meta_sync:not_ready"}, status_code=503)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        persist = True
        if isinstance(body, dict) and body.get("persist") is False:
            persist = False

        resp = await tick(force=True, persist=persist)
        return self.json({"ok": True, "sync": resp, "meta_store": domain_data.get("meta")})
