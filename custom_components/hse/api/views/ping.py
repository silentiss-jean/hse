"""HSE_DOC: custom_components/hse/docs/ping.md
HSE_MAINTENANCE: Health check endpoint — update doc if response shape changes.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX

VERSION = "0.1.0"


class PingView(HomeAssistantView):
    url = f"{API_PREFIX}/ping"
    name = "hse:unified:ping"
    requires_auth = True

    async def get(self, request):
        return self.json({"ok": True, "api": "unified", "version": VERSION})
