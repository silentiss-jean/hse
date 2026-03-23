"""HSE_DOC: custom_components/hse/docs/persistent_catalogue.md
HSE_MAINTENANCE: If you change catalogue schema or merge rules, update the doc above.
"""

from __future__ import annotations

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN


class CatalogueGetView(HomeAssistantView):
    url = f"{API_PREFIX}/catalogue"
    name = "hse:unified:catalogue_get"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        data = hass.data.get(DOMAIN, {}).get("catalogue")
        if not data:
            data = {"schema_version": 1, "generated_at": None, "items": {}, "settings": {}}
        return self.json(data)
