from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.helpers import entity_registry as er


def detect_kind(device_class: str | None, unit: str | None) -> str | None:
    if device_class == "energy" or unit in ("kWh", "Wh"):
        return "energy"
    if device_class == "power" or unit in ("W", "kW"):
        return "power"
    return None


def status_from_registry(
    reg_entry: er.RegistryEntry | None,
    *,
    ha_state: str | None = None,
    ha_restored: bool = False,
) -> tuple[str, str | None]:
    """Return (status, status_reason).

    status:
      - ok
      - disabled
      - not_provided
      - unknown
    """

    if reg_entry is None:
        return ("unknown", "entity_registry:missing")

    if reg_entry.disabled_by is not None:
        disabled_by_value = getattr(reg_entry.disabled_by, "value", str(reg_entry.disabled_by))
        return ("disabled", f"entity_registry:disabled_by:{disabled_by_value}")

    ent_status = getattr(reg_entry, "entity_status", None)
    if ent_status is not None:
        ent_status_value = getattr(ent_status, "value", str(ent_status))
        if ent_status_value == "not_provided":
            return ("not_provided", "entity_registry:not_provided")

    if reg_entry.config_entry_id is None and ha_restored and str(ha_state or "").lower() in ("unavailable", "unknown"):
        return ("not_provided", "entity_registry:orphaned+restored")

    return ("ok", None)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
