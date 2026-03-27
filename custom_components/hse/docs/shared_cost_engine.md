# Shared cost engine — `shared_cost_engine.py`

Target file:

- `custom_components/hse/shared_cost_engine.py`

---

## Purpose

UI-agnostic backend module that computes energy and cost snapshots per sensor. Used by `dashboard_overview.py` and `costs_compare.py` to produce consistent cost data without duplicating pricing logic.

---

## Key functions

### `build_sensor_cost_snapshot(hass, pricing, sensor_ref) -> dict`

Main entry point. Builds a full snapshot for one sensor.

**Parameters:**

- `hass`: Home Assistant instance.
- `pricing`: pricing dict from `catalogue.settings.pricing` (may be `None`).
- `sensor_ref`: either a plain `entity_id` string, or a catalogue item dict (preferred — carries `derived.helpers.energy`).

**Returns:**

```python
{
  "entity_id": str | None,
  "name": str | None,           # friendly_name or source.name or entity_id
  "base": str | None,           # derived slug (legacy path only)
  "helpers": {
    "total": str | None,
    "day": str | None,
    "week": str | None,
    "month": str | None,
    "year": str | None,
  },
  "helpers_resolution": "catalogue" | "legacy_derived",
  "power_w": float | None,       # live power in watts
  "energy_kwh": {
    "hour": float | None,        # derived from live power_w / 1000
    "day": float | None,
    "week": float | None,
    "month": float | None,
    "year": float | None,
  },
  "cost_ht": { "hour": ..., "day": ..., ... },
  "cost_ttc": { "hour": ..., "day": ..., ... },
  "warnings": list[str],
}
```

**Helper resolution priority:**

1. **Catalogue** (`derived.helpers.energy.*`) — preferred, explicit mapping persisted by `enrich/apply`.
2. **Legacy derived** — name-inferred from `derive_base_slug()`, used only when no catalogue mapping exists. Adds `"helpers_resolution:legacy_derived"` to warnings.

### `aggregate_sensor_cost_snapshots(snapshots) -> dict`

Aggregates a list of snapshots into totals per period.

Returns:

```python
{
  "hour": { "energy_kwh": float | None, "conso_ht": float | None, "conso_ttc": float | None },
  "day":  { ... },
  ...
}
```

Only sums periods where at least one snapshot has a value. Missing values are excluded from the sum (not treated as zero).

### `expected_energy_helpers(power_entity_id) -> dict`

Derives expected helper entity IDs from a power sensor entity_id using `derive_base_slug()`.

Returns: `{ "base", "total", "day", "week", "month", "year" }`.

---

## Periods

| Period | Source |
|---|---|
| `hour` | Live power state (`power_w / 1000`) |
| `day` | `sensor.{base}_kwh_day` |
| `week` | `sensor.{base}_kwh_week` |
| `month` | `sensor.{base}_kwh_month` |
| `year` | `sensor.{base}_kwh_year` |

---

## Warnings

| Code | Meaning |
|---|---|
| `helpers_resolution:legacy_derived` | No catalogue mapping found, fell back to name inference |
| `missing_live_power` | Power state is unavailable/unknown |
| `missing_helper_mapping:{period}` | No helper entity_id for this period |
| `missing_helper:{entity_id}` | Helper exists in mapping but state is unavailable |
| `{period}:missing_rate` | Pricing config incomplete |
| `{period}:invalid_contract_type` | Contract type not `fixed` or `hphc` |

---

## Maintenance notes

- This module must remain UI-agnostic. Do not import view classes or frontend-specific code here.
- Always pass a catalogue item dict as `sensor_ref` when available — the legacy path exists only for backwards compatibility.
- If a new period is added, update `_PERIODS`, `_HELPER_SUFFIX_BY_PERIOD`, and all callers.
