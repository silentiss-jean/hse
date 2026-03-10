"""HSE_DOC: custom_components/hse/docs/persistent_catalogue.md
HSE_MAINTENANCE: If you change refresh behavior or endpoints, update the doc above.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN


class CatalogueRefreshView(HomeAssistantView):
    url = f"{API_PREFIX}/catalogue/refresh"
    name = "hse:unified:catalogue_refresh"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]
        refresher = hass.data.get(DOMAIN, {}).get("catalogue_refresh")
        if not refresher:
            return self.json({"ok": False, "error": "catalogue_refresh:not_ready"}, status_code=503)

        result = await refresher(force=True)
        return self.json({"ok": True, "result": result})
