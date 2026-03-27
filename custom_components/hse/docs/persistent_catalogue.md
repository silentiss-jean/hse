# Persistent catalogue & enrichment (V1)

HSE scans existing Home Assistant entities, persists a catalogue in backend storage, and lets the user enrich each source sensor with stable metadata and derived-helper bindings.

This document defines the current schema expectations for the persistent catalogue and the enrichment flow.

Related modules: `repairs.py` (health → Repairs issues), `time_utils.py` (UTC timestamps).

---

## Canonical units

Internal canonical units for computation:

- Power: W
- Energy: Wh
- Cost: integer cents

---

## Period model

Two week definitions exist at the product level:

- ISO week: `week` (Monday 00:00 → Sunday 23:59 local)
- Custom week: `week_custom` (configurable start day + time, persisted)

For the current helper-based energy pipeline, the persisted helper mapping used by overview/cost logic is:

- `total`
- `day`
- `week`
- `month`
- `year`

The weekly slot currently refers to the standard weekly helper created by Home Assistant utility meters.

---

## Item schema (v1)

Each item keeps:

- `source.*`: current snapshot from HA + last seen state
- `enrichment.*`: user choices (include/reference/room/type/naming)
- `derived.enabled.*`: gates which derived entities are allowed
- `derived.helpers.energy.*`: explicit mapping to helper entities used by backend calculations
- `health.*`: offline tracking and escalation state
- `triage.*`: user triage (mute / removed)
- `workflow.*`: transient enrichment workflow state slots

### enrichment

Common keys (non exhaustive):

- `include` (bool): if true, this item is part of "measured totals" aggregations.
- `is_reference_total` (bool): marks the "main meter" / "compteur" total.

Invariant:

- If `is_reference_total = true`, this item must be excluded from measured totals, and the backend forces `include = false`.

Important:

- Excluding the reference from measured totals does **not** mean it should be excluded from helper enrichment.
- The reference sensor must have its own energy helper mapping so overview can compute day/week/month/year values for the main meter.

### derived.helpers.energy

This block is the source of truth for energy helper resolution.

Expected keys:

- `source_power_entity_id`: source power sensor entity_id
- `total`: energy total helper entity_id
- `day`: daily utility meter helper entity_id
- `week`: weekly utility meter helper entity_id
- `month`: monthly utility meter helper entity_id
- `year`: yearly utility meter helper entity_id
- `status`: `unknown|partial|ready`
- `resolution_mode`: currently `explicit` once persisted in catalogue
- `last_resolved_at`: ISO timestamp of last helper resolution attempt (from `utc_now_iso()`)
- `issues`: list of missing/inconsistent helper diagnostics

Rules:

- Backend cost/overview logic must prefer `derived.helpers.energy.*` over helper-name inference.
- Name-derived helper lookup is legacy compatibility only and should not be treated as the primary contract.
- When helpers are created or discovered, the mapping must be persisted back into the catalogue.

### reference total behavior

When the user saves a reference sensor through `catalogue/reference_total`:

- the item is marked `is_reference_total = true`
- `include` is forced to `false`
- helper creation / helper resolution is triggered immediately for that reference sensor
- the resulting `derived.helpers.energy` mapping is persisted on the reference item

This is intentionally separate from `pricing.cost_entity_ids`:

- the reference sensor is **not** automatically added to the measured cost sensors list
- the reference still gets helpers because overview needs an independent main-meter energy timeline

### workflow.reference_enrichment

Transient workflow slot populated by `catalogue_reference_total.py` during helper creation for the reference sensor.

Key fields:

- `job_id`: UUID identifying the current enrichment job.
- `status`: `idle` | `running` | `ready` | `failed` | `pending_background`
- `progress_phase`: internal phase label (e.g. `ensure_total`, `ready`, `failed`).
- `progress_label`: human-readable French status string.
- `attempt` / `attempts_total`: synchronous retry counter (max 3).
- `will_retry` / `retry_scheduled`: flags for retry state.
- `last_error`: last error code if failed.
- `mapping`: snapshot of the resolved `derived.helpers.energy` at last attempt.
- `started_at`, `updated_at`, `finished_at`: UTC ISO timestamps (from `utc_now_iso()`).
- `done`: `true` when status is `ready` or `failed`.

Background retry constants:

- Max background passes: **8** (`_REFERENCE_BG_MAX_PASSES`)
- Delay between passes: **5 seconds** (`_REFERENCE_BG_DELAY_S`)
- Status URL: `POST /api/hse/unified/catalogue/reference_total/status`

### health

- `first_unavailable_at`: first time we observed `unknown/unavailable` (or `not_provided`) — ISO UTC timestamp
- `last_ok_at`: last time we observed a non-unavailable state — ISO UTC timestamp
- `escalation`: `none|error_24h|action_48h`

Escalation is computed by comparing `seconds_since(first_unavailable_at)` against `CATALOGUE_OFFLINE_GRACE_S` (900s) and fixed thresholds (86400s / 172800s).

HA Repairs issues are created/deleted by `repairs.py` based on this escalation value.

### triage

- `policy`: `normal|removed`
- `mute_until`: ISO timestamp; while now < mute_until, no escalation should be raised

Important: `triage.policy=removed` is lifecycle/archival, not the same as `enrichment.include=false`.

---

## Enrichment rules

There are now two valid ways an item gets its helper mapping:

1. `enrich/apply` creates or discovers helpers for selected source sensors and persists `derived.helpers.energy`.
2. `catalogue/reference_total` triggers the same helper-creation/resolution path for the chosen reference sensor at save time.

As a result, all sensors used by overview should converge toward the same explicit catalogue contract, whether they are measured sensors or the main reference meter.
