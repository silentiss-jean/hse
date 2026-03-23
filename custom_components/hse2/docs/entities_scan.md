# Entities scan API (`entities_scan.py`)

This document describes the **unified entities scan** endpoint implemented by:

- `custom_components/hse/api/views/entities_scan.py` [EntitiesScanView]

It is written to be quickly digestible by an AI agent (clear structure, explicit rules), with extra context for humans where useful.

---

## Purpose

The scan endpoint returns a curated list of **candidate power/energy sensors** found in Home Assistant, grouped by integration/platform, with additional metadata to help decide:

- Which entities are **useful** as sources for HSE computations.
- Which entities are **disabled**, **orphaned**, or **not provided** anymore.
- Which entities are currently **unavailable** or **restored** (runtime health).

The endpoint is designed for the HSE panel "Détection" UI.

---

## Route

- **Method**: `GET`
- **URL**: `/{API_PREFIX}/entities/scan`
  - In this project it is called by the frontend as:
    - `/api/hse/unified/entities/scan?...`
- **Auth**: required (`requires_auth = True`)

Registration is performed in:

- `custom_components/hse/api/unified_api.py` via `hass.http.register_view(EntitiesScanView())`

---

## Query parameters

| Param | Type | Default | Meaning |
|------|------|---------|---------|
| `include_disabled` | bool | `false` | If `false`, entities disabled in the entity registry are excluded from results. |
| `exclude_hse` | bool | `true` | If `true`, entities belonging to HSE (platform `hse` or `sensor.hse_*`) are excluded. |

Boolean parsing (`_q_bool`) accepts: `1, true, yes, y, on` (case-insensitive).

---

## Data sources

The scan merges two HA data sources:

1) **Runtime states** (authoritative for current state):

- Iterates `hass.states.async_all()`.
- This is where `ha_state` comes from.
- Attributes like `device_class`, `unit_of_measurement`, `state_class`, `friendly_name`, and `restored` are read from `st.attributes`.

2) **Entity registry** (authoritative for "administrative" metadata):

- `ent_reg = entity_registry.async_get(hass)`
- `reg_entry = ent_reg.entities.get(entity_id)`
- This is where `platform`, `unique_id`, `config_entry_id`, `device_id`, `area_id`, and `disabled_by` come from.

Important consequence:

- The scan only returns entities that exist in **runtime states** at scan time.
- Registry-only entities with no state entry will not appear.

---

## Candidate detection (which entities are included)

The scan is intentionally selective.

### Step 1 — Domain filter

Only entities whose entity_id domain equals `sensor` are considered.

- `sensor.*` → continue
- everything else (`switch.*`, `binary_sensor.*`, etc.) → skipped

### Step 2 — Power/Energy filter

Only sensors classified as **power** or **energy** are kept.

Detection (`_detect_kind`) rules:

- `energy` if `device_class == "energy"` OR unit is `kWh` or `Wh`
- `power` if `device_class == "power"` OR unit is `W` or `kW`
- otherwise → not a candidate

This means the scan ignores e.g. temperature sensors or sensors without clear energy/power semantics.

### Step 3 — Disabled filter (optional)

If `include_disabled=false` and the entity registry entry has `disabled_by != None`, the entity is excluded.

### Step 4 — Exclude HSE filter (optional)

If `exclude_hse=true`, entities are excluded when:

- their registry platform equals `hse` (`DOMAIN`), OR
- their entity_id starts with `sensor.hse_`

This keeps the scan focused on **source** entities rather than HSE-generated entities.

---

## Status model

Each candidate includes two independent concepts:

1) **Registry status** (`status`, `status_reason`)
2) **Runtime health** (`ha_state`, `ha_restored`)

### Runtime health fields

| Field | Type | Meaning |
|------|------|---------|
| `ha_state` | string | The current HA state value for the entity (e.g. `"0.0"`, `"unavailable"`). |
| `ha_restored` | bool | `true` if HA marked the entity as restored from persistence (`attributes.restored`). |

These are meant to explain situations where an entity exists but doesn't currently provide live data.

### Registry status fields

`status` values:

- `ok`
- `disabled`
- `not_provided`
- `unknown`

Computation rules (in order):

1) If there is **no registry entry** for the entity: `status="unknown"`, `status_reason="entity_registry:missing"`.
2) If registry entry is **disabled** (`disabled_by != None`):
   - `status="disabled"`
   - `status_reason="entity_registry:disabled_by:<value>"`
3) If registry entry exposes an explicit `entity_status` and it equals `not_provided`:
   - `status="not_provided"`
   - `status_reason="entity_registry:not_provided"`
4) Conservative fallback for "not provided" when explicit registry field is missing (HA version differences):
   - If `config_entry_id is None` **AND** `ha_restored==true` **AND** `ha_state in {unavailable, unknown}`:
     - `status="not_provided"`
     - `status_reason="entity_registry:orphaned+restored"`
5) Otherwise: `status="ok"`, `status_reason=null`.

Why this split exists:

- A registry status of `ok` does not guarantee the entity is producing live data; `ha_state` can still be `unavailable`.
- Conversely, an entity can be `not_provided` (integration no longer provides it) even if it still has a restored/unavailable state.

---

## Output format (response JSON)

Top-level keys:

- `generated_at`: ISO8601 UTC timestamp
- `rules`: echoed scan options (`include_disabled`, `exclude_hse`)
- `integrations`: array of integration summaries
- `candidates`: array of candidate entities

### `integrations[]`

Each item:

- `integration_domain`: derived from registry platform (`platform`) or `"unknown"`
- `power_count`
- `energy_count`
- `total`

Sorted by `total` desc.

### `candidates[]`

Each candidate includes (non-exhaustive list):

- `entity_id`
- `kind` (`power|energy`)
- `unit`, `device_class`, `state_class`
- `name`
- `integration_domain` (same as `platform` fallback to `unknown`)
- `platform`, `config_entry_id`, `device_id`, `area_id`, `unique_id`
- `disabled_by`
- `status`, `status_reason`
- `ha_state`, `ha_restored`
- `source.is_hse`

---

## Usage scenarios (practical)

### Scenario A — Normal live sensor

Example patterns:

- `status=ok`
- `ha_state` is numeric (e.g. `"74"` or `"0.0"`)
- `ha_restored=false`

Interpretation:

- Good candidate for HSE.

### Scenario B — Disabled entity

- `status=disabled`
- Often excluded entirely when `include_disabled=false`

Interpretation:

- Candidate exists, but user/integration disabled it; likely not a valid source.

### Scenario C — Orphaned / not provided entity

Typical when:

- The YAML/template/integration that created the entity was removed.
- The entity remains in the registry and appears in HA with a banner "not provided".

Scan patterns:

- `status=not_provided`
- `status_reason` often `entity_registry:not_provided` or `entity_registry:orphaned+restored`
- `ha_state` often `unavailable`
- `ha_restored=true`

Interpretation:

- Entity should likely be deleted from HA if unused; it is not a valid live source.

### Scenario D — Device offline / temporarily unavailable

Patterns:

- `status=ok` (registry is fine)
- `ha_state=unavailable` but `ha_restored=false` (device/integration issue)

Interpretation:

- Entity is still provided by integration but currently offline; do not delete hastily.

---

## Notes / design tradeoffs

- The scan is state-driven; entities with no current state entry are invisible.
- The "not provided" detection can vary by HA version; the conservative fallback reduces false positives.
- The scan is intentionally limited to `sensor` power/energy; extending it to other domains should be explicit.

---

## Troubleshooting checklist

When an entity looks wrong in scan results:

1) Compare runtime state:
   - `GET /api/states/<entity_id>`
2) Compare registry entry:
   - `.storage/core.entity_registry` (or entity registry debug tools)
3) Check scan output:
   - `GET /api/hse/unified/entities/scan?...`
4) Look at `status_reason` and `ha_restored`.

---
