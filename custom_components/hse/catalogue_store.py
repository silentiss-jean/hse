from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .catalogue_schema import catalogue_store_key, default_catalogue


def get_store(hass: HomeAssistant) -> Store:
    # Store version is independent of schema_version inside JSON.
    return Store(hass, 1, catalogue_store_key())


async def async_load_catalogue(hass: HomeAssistant) -> dict[str, Any]:
    store = get_store(hass)
    data = await store.async_load()
    if isinstance(data, dict) and data.get("schema_version") == 1 and "items" in data:
        return data
    return default_catalogue()


async def async_save_catalogue(hass: HomeAssistant, data: dict[str, Any]) -> None:
    store = get_store(hass)
    await store.async_save(data)
