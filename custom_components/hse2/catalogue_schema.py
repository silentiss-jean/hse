from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class CatalogueSettings:
    custom_week_enabled: bool = False
    custom_week_start_day: str = "fri"  # mon,tue,wed,thu,fri,sat,sun
    custom_week_start_time: str = "00:00"  # HH:MM (local)


def default_catalogue() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "generated_at": _utc_now_iso(),
        "settings": {
            "custom_week_enabled": False,
            "custom_week_start_day": "fri",
            "custom_week_start_time": "00:00",
        },
        "items": {},
    }


def catalogue_store_key() -> str:
    # single_config_entry=true => store a single shared catalogue.
    return "hse.catalogue"
