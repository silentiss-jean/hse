from __future__ import annotations

from typing import Any

from .const import DOMAIN


def meta_store_key() -> str:
    return f"{DOMAIN}.meta"


def default_meta() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "generated_at": None,
        "meta": {
            "rooms": [],
            "types": [],
            "assignments": {},
            "rules": {
                "room_from_ha_area": True,
                "type_rules": [],
            },
            "updated_at": None,
        },
        "sync": {
            "last_run": None,
            "last_error": None,
            "pending_diff": None,
            "pending_generated_at": None,
            "snapshot": None,
        },
    }
