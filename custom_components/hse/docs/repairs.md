# Repairs — `repairs.py`

Target file:

- `custom_components/hse/repairs.py`

HSE_DOC declared in source: `persistent_catalogue.md` (shared health/triage contract).

---

## Purpose

`repairs.py` synchronises Home Assistant Repairs issues with the catalogue health state. It creates or deletes HA issue registry entries based on the `health.escalation` field on each catalogue item.

---

## Entry point

- `async_sync_repairs(hass) -> None`

Called periodically (typically after each catalogue refresh cycle) to reflect the current health state into HA Repairs.

---

## Logic

For each item in `catalogue.items`:

1. If `triage.policy == "removed"` → delete the issue unconditionally.
2. If `health.escalation` is not `error_24h` or `action_48h` → delete the issue (no active problem).
3. Otherwise → create or update the issue with:
   - `severity`: `ERROR` for `error_24h`, `CRITICAL` for `action_48h`.
   - `translation_key`: `catalogue_offline`
   - `translation_placeholders`: `entity_id`, `since` (ISO timestamp of first unavailability).
   - `is_fixable = False`, `is_persistent = True`.

---

## Issue ID format

```
catalogue_offline_{item_id_with_colons_replaced_by_underscores}
```

Example: item_id `sensor:abc:123` → issue ID `catalogue_offline_sensor_abc_123`.

---

## Escalation levels (from `health.escalation`)

| Value | Severity | Meaning |
|---|---|---|
| `none` | — | No issue created |
| `error_24h` | ERROR | Entity offline > 24h |
| `action_48h` | CRITICAL | Entity offline > 48h |

Thresholds are computed in the catalogue refresh cycle (not in this file). See `catalogue_manager.py`.

---

## Maintenance notes

- If issue IDs change, old issues from previous versions will not be auto-deleted. A migration step may be needed.
- `translation_key = "catalogue_offline"` must exist in `strings.json` / `translations/fr.json`.
- `is_fixable = False` means no repair action is offered to the user — the issue is informational only.
