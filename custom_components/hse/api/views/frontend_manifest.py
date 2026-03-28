"""HSE_DOC: custom_components/hse/docs/frontend_manifest.md
HSE_MAINTENANCE: If panel constants or feature flags change, update the doc above.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, PANEL_TITLE, PANEL_ELEMENT_NAME, PANEL_JS_URL, STATIC_URL

VERSION = "0.1.0"


class FrontendManifestView(HomeAssistantView):
    url = f"{API_PREFIX}/frontend_manifest"
    name = "hse:unified:frontend_manifest"
    requires_auth = True

    async def get(self, request):
        return self.json(
            {
                "ok": True,
                "version": VERSION,
                "panel": {
                    "title": PANEL_TITLE,
                    "element_name": PANEL_ELEMENT_NAME,
                    "js_url": PANEL_JS_URL,
                },
                "static": {"url": STATIC_URL},
                "features": {
                    "scan": True,
                    "auto_select": False,
                    "cost_preview": False,
                },
            }
        )
