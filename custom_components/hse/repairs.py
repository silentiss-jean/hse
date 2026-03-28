"""HSE_DOC: custom_components/hse/docs/repairs.md
HSE_MAINTENANCE: If you change repair issue IDs or severity mapping, update the doc above.
"""

from __future__ import annotations

from homeassistant.helpers import issue_registry as ir

from .const import DOMAIN


def _issue_id(item_id: str) -> str:
    return f"catalogue_offline_{item_id.replace(':', '_')}"


async def async_sync_repairs(hass) -> None:
    """Create/delete repairs issues based on catalogue health/escalation."""

    cat = hass.data.get(DOMAIN, {}).get("catalogue") or {}
    items = cat.get("items") or {}

    for item_id, item in items.items():
        if not isinstance(item, dict):
            continue

        triage = item.get("triage") or {}
        if triage.get("policy") == "removed":
            ir.async_delete_issue(hass, DOMAIN, _issue_id(item_id))
            continue

        health = item.get("health") or {}
        esc = health.get("escalation") or "none"

        # Only create Repairs issues for 24h/48h thresholds.
        if esc not in ("error_24h", "action_48h"):
            ir.async_delete_issue(hass, DOMAIN, _issue_id(item_id))
            continue

        entity_id = (item.get("source") or {}).get("entity_id") or item_id
        first_unavail = health.get("first_unavailable_at")

        severity = ir.IssueSeverity.ERROR if esc == "error_24h" else ir.IssueSeverity.CRITICAL

        ir.async_create_issue(
            hass,
            DOMAIN,
            _issue_id(item_id),
            is_fixable=False,
            is_persistent=True,
            severity=severity,
            translation_key="catalogue_offline",
            translation_placeholders={
                "entity_id": entity_id,
                "since": str(first_unavail or "?")
            },
        )
