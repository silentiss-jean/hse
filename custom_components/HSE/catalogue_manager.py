from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .catalogue_defaults import ensure_item_defaults
from .time_utils import parse_iso, utc_now_iso


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _item_id_from_source(source: dict[str, Any]) -> str:
    platform = source.get("platform") or source.get("integration_domain") or "unknown"
    unique_id = source.get("unique_id")
    if unique_id:
        return f"reg:{platform}:{unique_id}"

    entity_id = source.get("entity_id") or "unknown"
    return f"ent:{entity_id}"


def _is_unavailable_state(ha_state: str | None) -> bool:
    return str(ha_state or "").lower() in ("unavailable", "unknown")


def _update_health(existing: dict[str, Any], *, ha_state: str | None, status: str | None, now_iso: str) -> None:
    health = existing.setdefault("health", {})

    if status == "not_provided":
        if not health.get("first_unavailable_at"):
            health["first_unavailable_at"] = now_iso
        return

    if _is_unavailable_state(ha_state):
        if not health.get("first_unavailable_at"):
            health["first_unavailable_at"] = now_iso
        return

    health["last_ok_at"] = now_iso
    health["first_unavailable_at"] = None
    health["escalation"] = "none"


def _compute_escalation(existing: dict[str, Any], *, offline_grace_s: int, now: datetime) -> None:
    triage = existing.get("triage") or {}
    if triage.get("policy") == "removed":
        existing.setdefault("health", {})["escalation"] = "none"
        return

    mute_until = parse_iso(triage.get("mute_until"))
    if mute_until and now < mute_until:
        existing.setdefault("health", {})["escalation"] = "none"
        return

    health = existing.get("health") or {}
    first_unavail = parse_iso(health.get("first_unavailable_at"))
    if not first_unavail:
        health["escalation"] = "none"
        return

    status = ((existing.get("source") or {}).get("status") or "").lower()
    offline_s = int((now - first_unavail).total_seconds())

    if status == "not_provided":
        health["escalation"] = "warning_15m"
        return

    if offline_s < offline_grace_s:
        health["escalation"] = "none"
    elif offline_s >= 48 * 3600:
        health["escalation"] = "action_48h"
    elif offline_s >= 24 * 3600:
        health["escalation"] = "error_24h"
    else:
        health["escalation"] = "warning_15m"


def merge_scan_into_catalogue(catalogue: dict[str, Any], scan: dict[str, Any], *, offline_grace_s: int = 900) -> dict[str, Any]:
    items: dict[str, Any] = catalogue.setdefault("items", {})
    now_iso = utc_now_iso()
    now_dt = datetime.now(timezone.utc)

    for c in scan.get("candidates", []) or []:
        item_id = _item_id_from_source(c)

        existing = items.get(item_id)
        if not isinstance(existing, dict):
            existing = {"item_id": item_id}

        existing = ensure_item_defaults(existing, base_entity_id=c.get("entity_id"))

        src = existing.setdefault("source", {})
        for k in (
            "entity_id",
            "kind",
            "unit",
            "device_class",
            "state_class",
            "unique_id",
            "device_id",
            "area_id",
            "integration_domain",
            "platform",
            "config_entry_id",
            "disabled_by",
            "status",
            "status_reason",
        ):
            if k in c:
                src[k] = c.get(k)

        src["last_seen_state"] = c.get("ha_state")
        src["last_seen_at"] = now_iso

        naming = existing.get("enrichment", {}).get("naming", {})
        if isinstance(naming, dict) and naming.get("mode") != "locked":
            naming["base_entity_id"] = c.get("entity_id")

        _update_health(existing, ha_state=c.get("ha_state"), status=c.get("status"), now_iso=now_iso)
        _compute_escalation(existing, offline_grace_s=offline_grace_s, now=now_dt)

        items[item_id] = existing

    # Ensure removed items never keep stale escalation between scans
    for it in (items.values() or []):
        if not isinstance(it, dict):
            continue
        if (it.get("triage") or {}).get("policy") == "removed":
            it.setdefault("health", {})["escalation"] = "none"

    catalogue["generated_at"] = now_iso
    return catalogue
