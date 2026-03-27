# API — `diagnostic/check`

Target file:

- `custom_components/hse/api/views/diagnostic_check.py`

---

## Endpoint

```
POST /api/hse/unified/diagnostic/check
```

Requires auth: yes. **Admin only** (returns 403 for non-admin users).

---

## Purpose

Detects catalogue inconsistencies for a list of entity IDs. For each entity, it compares the catalogue items, active HA config entries, and entity presence to produce a structured health report with actionable diagnostics.

---

## Request body

```json
{
  "entity_ids": ["sensor.xxx"],
  "checks": ["catalogue_duplicates", "config_entry_consistency", "entity_presence", "helper_consistency"],
  "include_history": true
}
```

- `entity_ids`: list of entity IDs to check. If empty/omitted, all entity IDs present in the catalogue are used.
- `checks`: which check categories to run. Defaults to all four if omitted.
- `include_history`: if `true`, historical catalogue items (non-current) are included in the per-entity detail.

---

## Response structure

```json
{
  "generated_at": "<ISO>",
  "input": { "entity_ids": [...], "checks": [...], "include_history": true },
  "summary": {
    "checked_count": 5,
    "issues_found": 1,
    "warning_count": 1,
    "error_count": 0,
    "reason_codes": ["entity_missing_but_catalogue_present"]
  },
  "results": [ { ...per entity... } ]
}
```

### Per-entity result

Key fields:

- `entity_id`: the entity checked.
- `status`: `"ok"` | `"warning"` | `"error"`.
- `reason_code`: see table below.
- `explanation`: human-readable French string.
- `counts`: catalogue item counts by type (operational, historical, removed, archived).
- `entity_presence`: `{ state_exists, state_value, registry_exists }`.
- `current_item`: the selected canonical catalogue item for this entity.
- `historical_items`: previous catalogue items (if `include_history: true`).
- `active_config_entries`: HA config entries found matching operational rows.
- `next_step.safe_to_auto_fix`: `true` when `reason_code == historical_catalogue_duplicates` and archivable items exist.
- `next_step.archive_item_ids`: list of non-current item IDs that can be safely archived.

---

## Reason codes

| Code | Status | Meaning |
|---|---|---|
| `no_issue` | ok | No inconsistency detected |
| `entity_missing_but_catalogue_absent` | ok | Entity not found, and not in catalogue either |
| `entity_missing_but_catalogue_present` | warning | Catalogue has an operational item, but entity no longer exists in HA |
| `entity_unavailable` | warning | Entity exists but state is `unknown` or `unavailable` |
| `historical_catalogue_duplicates` | warning | Multiple operational rows share the same `entity_id`, but only one active config entry exists (safe to consolidate) |
| `multiple_live_helpers` | error | Multiple operational rows AND multiple active config entries coexist for the same entity |

---

## Current item selection algorithm

The "current" item is selected by sorting candidate rows on:

1. Whether the row's `config_entry_id` matches an active HA config entry (active = preferred).
2. Whether the row is operational (non-historical).
3. `source.last_seen_at` descending.
4. `item_id` as tiebreaker.

The `selection_reason` field in `current_item` explains which rule applied.

---

## Maintenance notes

- If new triage policies are added in `catalogue_manager.py`, update `HISTORICAL_POLICIES` in this file.
- `safe_to_auto_fix` gates the consolidation UX in the frontend. Do not set it to `true` unless the action is clearly safe and reversible.
