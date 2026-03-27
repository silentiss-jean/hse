# API — Enrich endpoints

Target files:

- `custom_components/hse/api/views/enrich_preview.py`
- `custom_components/hse/api/views/enrich_apply.py`
- `custom_components/hse/api/views/enrich_diagnose.py`
- `custom_components/hse/api/views/enrich_cleanup.py`

---

## Overview

The enrich endpoints manage the lifecycle of HA helper entities (Integral + utility meters) that HSE creates for each power sensor. The typical flow is:

```
preview → apply → diagnose (debug) → cleanup (if needed)
```

All endpoints are **admin only** (return 403 for non-admin users).

---

## `POST /api/hse/unified/enrich/preview`

### Purpose

Dry-run: shows which helper entities would be created for the current pricing selection, without creating anything.

### Request body

```json
{ "entity_ids": ["sensor.xxx"] }
```

If `entity_ids` is omitted, uses `catalogue.settings.pricing.cost_entity_ids`.

### Response

```json
{
  "generated_at": "<ISO>",
  "input": { "entity_ids": [...] },
  "summary": { "to_create_count": 3, "already_ok_count": 2, "errors_count": 0, "decisions_required_count": 0 },
  "per_source": [
    {
      "power_entity_id": "sensor.xxx",
      "base": "xxx",
      "expected": ["sensor.xxx_kwh_total", "sensor.xxx_kwh_day", ...],
      "already_ok": [...],
      "to_create": [...]
    }
  ],
  "to_create": [...],
  "already_ok": [...],
  "decisions_required": [...],
  "errors": []
}
```

### `derive_base_slug()` — slug derivation

Strips known power sensor suffixes before deriving the base name:

- `_consommation_actuelle`
- `_puissance`
- `_power`
- `_w`
- `_watts`

Example: `sensor.chambre_alex_pc_consommation_actuelle` → base `chambre_alex_pc`

If slug cannot be derived, entity appears in `decisions_required` with code `base_slug`.

---

## `POST /api/hse/unified/enrich/apply`

### Purpose

Creates helper entities for selected power sensors and persists the explicit `derived.helpers.energy` mapping into each catalogue item.

### Request body

```json
{
  "entity_ids": ["sensor.xxx"],
  "mode": "create_helpers",
  "safe": true,
  "self_heal": true
}
```

- `mode`: `"create_helpers"` (default) or `"export_yaml"` (returns YAML only, no creation).
- `safe`: if `true`, aborts creation if the power sensor state is `unknown`/`unavailable` at call time.
- `self_heal`: if `true`, removes stale orphaned config entries before retrying creation.
- `entity_ids`: if omitted, uses pricing selection + current reference sensor.

### Multi-attempt workflow

For each power sensor, `enrich/apply` runs up to **3 attempts** (`_HELPER_SYNC_ATTEMPTS`) to create the helpers:

1. Creates the Integral helper (`*_kwh_total`) via config flow.
2. Waits up to 6s for the entity to appear in HA state/registry.
3. Creates the 4 utility meter helpers (`*_kwh_day|week|month|year`).
4. Persists the resolved mapping into the catalogue item.

If the `*_kwh_total` helper is not yet ready (state still `unknown`) after all synchronous attempts, the workflow transitions to **`pending_background`**: a background task continues polling every **5 seconds** for up to **8 passes** (`_HELPER_BG_MAX_PASSES`).

### Workflow states

| State | Meaning |
|---|---|
| `running` | Active synchronous creation in progress |
| `ready` | All helpers created and mapping persisted |
| `failed` | Non-recoverable error |
| `pending_background` | Waiting for `*_kwh_total` to become ready in background |

Workflow state is stored in `item.workflow.helper_enrichment` in the catalogue.

### Response

```json
{
  "generated_at": "<ISO>",
  "mode": "create_helpers",
  "input": { "entity_ids": [...], "safe": true, "self_heal": true },
  "summary": { "created_count": 5, "skipped_count": 0, "errors_count": 0, "decisions_required_count": 0 },
  "created": [...],
  "skipped": [...],
  "errors": [...],
  "decisions_required": [...],
  "helper_statuses": [...],
  "exports": { "option2_templates_riemann_yaml": "...", "option1_utility_meter_yaml": "..." }
}
```

---

## `POST /api/hse/unified/enrich/diagnose`

### Purpose

Reads the current state of all helpers for selected power sensors without creating or modifying anything. Returns readiness flags and hints.

### Request body

```json
{ "entity_ids": ["sensor.xxx"] }
```

If omitted, uses pricing selection.

### Response

```json
{
  "generated_at": "<ISO>",
  "input": { "entity_ids": [...] },
  "bases": [
    {
      "base": "xxx",
      "power": { "entity_id": "sensor.xxx", "state": "120.5", "unit": "W", "exists": true, "config_ok": true },
      "total": { "entity_id": "sensor.xxx_kwh_total", "state": "3.14", "exists": true, "config_entry_exists": true },
      "meters": [
        { "cycle": "daily", "entity_id": "sensor.xxx_kwh_day", "state": "0.8", "exists": true, "config_entry_exists": true },
        ...
      ],
      "ready": { "power_numeric": true, "total_numeric": true },
      "hints": []
    }
  ]
}
```

### Common hints

- `"Puissance: unknown/unavailable → attendre une mesure puis relancer"`
- `"kWh total: encore unknown → l'Integral n'a pas encore reçu de delta"`
- `"Puissance: unité attendue W/kW"`

---

## `POST /api/hse/unified/enrich/cleanup`

### Purpose

Finds and optionally removes stale HA config entries for integration and utility_meter helpers that no longer have a corresponding entity in the HA state machine or entity registry.

### Request body

```json
{
  "dry_run": true,
  "stale_only": true,
  "types": ["integration", "utility_meter"],
  "entity_ids": ["sensor.xxx"]
}
```

- `dry_run` (default `true`): if `true`, only lists candidates without removing anything.
- `stale_only` (default `true`): if `true`, only considers config entries whose expected entity is absent.
- `types`: which helper domains to scan. Default: both `integration` and `utility_meter`.
- `entity_ids`: if omitted, uses pricing selection.

### Response

```json
{
  "generated_at": "<ISO>",
  "input": { "dry_run": true, "stale_only": true, "types": [...], "entity_ids": [...] },
  "candidates": [
    { "domain": "integration", "name": "xxx_kwh_total", "entity_id": "sensor.xxx_kwh_total", "entry_id": "abc", "stale": true }
  ],
  "removed": []
}
```

**Always run with `dry_run: true` first** to review candidates before committing removal.

---

## Maintenance notes

- `derive_base_slug()` is duplicated between `enrich_preview.py` and `shared_cost_engine.py`. Both copies must stay in sync if suffix rules change.
- Background task state (`pending_background`) is stored in the catalogue. If HA restarts during a pending background pass, the task is lost — the user must re-run `enrich/apply`.
- `self_heal` removes stale config entries silently. Disable it (`self_heal: false`) if you want conservative behaviour without auto-deletion.
