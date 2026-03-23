from __future__ import annotations

from typing import Any

from .time_utils import utc_now_iso


def ensure_item_defaults(existing: dict[str, Any], *, base_entity_id: str | None) -> dict[str, Any]:
    """Ensure new item structure exists (schema v1 + health/triage additions)."""
    existing.setdefault("item_id", None)
    existing.setdefault("source", {})

    enrichment = existing.setdefault("enrichment", {})
    enrichment.setdefault("include", True)
    enrichment.setdefault("is_reference_total", False)
    enrichment.setdefault("room", None)
    enrichment.setdefault("type", None)
    enrichment.setdefault("tags", [])
    enrichment.setdefault("note", None)

    naming = enrichment.setdefault("naming", {})
    naming.setdefault("mode", "auto")
    naming.setdefault("base_entity_id", base_entity_id)

    calculation = enrichment.setdefault("calculation", {})
    calculation.setdefault("energy_method", "native")
    calculation.setdefault("power_to_energy_interval_s", 60)

    derived = existing.setdefault("derived", {})
    derived.setdefault(
        "enabled",
        {
            "energy_day": True,
            "energy_week": True,
            "energy_week_custom": False,
            "energy_month": True,
            "energy_year": True,
            "cost_day": True,
            "cost_week": True,
            "cost_week_custom": False,
            "cost_month": True,
            "cost_year": True,
        },
    )

    helpers = derived.setdefault("helpers", {})
    energy_helpers = helpers.setdefault("energy", {})
    energy_helpers.setdefault("source_power_entity_id", base_entity_id)
    energy_helpers.setdefault("total", None)
    energy_helpers.setdefault("day", None)
    energy_helpers.setdefault("week", None)
    energy_helpers.setdefault("month", None)
    energy_helpers.setdefault("year", None)
    energy_helpers.setdefault("status", "unknown")
    energy_helpers.setdefault("resolution_mode", None)
    energy_helpers.setdefault("last_resolved_at", None)
    energy_helpers.setdefault("issues", [])

    existing.setdefault(
        "health",
        {
            "first_unavailable_at": None,
            "last_ok_at": None,
            "escalation": "none",  # none|error_24h|action_48h
        },
    )

    existing.setdefault(
        "triage",
        {
            "policy": "normal",  # normal|removed
            "mute_until": None,
            "note": None,
            "updated_at": utc_now_iso(),
        },
    )

    return existing
