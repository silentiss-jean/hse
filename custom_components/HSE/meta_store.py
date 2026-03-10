from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .meta_schema import default_meta, meta_store_key


def get_store(hass: HomeAssistant) -> Store:
    return Store(hass, 1, meta_store_key())


async def async_load_meta(hass: HomeAssistant) -> dict[str, Any]:
    store = get_store(hass)
    data = await store.async_load()
    if isinstance(data, dict) and data.get("schema_version") == 1 and "meta" in data and "sync" in data:
        return data
    return default_meta()


async def async_save_meta(hass: HomeAssistant, data: dict[str, Any]) -> None:
    store = get_store(hass)
    await store.async_save(data)
