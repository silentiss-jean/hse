"""
HSE_DOC: custom_components/hse/docs/unified_api.md
HSE_MAINTENANCE: Central registration point for unified HTTP API views.

AI-first:
- Entry point and contracts.
- List of registered views.
- Rules for adding a new view.

Human layer:
- Common failure modes.
- Debug checklist.
"""

---

## Purpose

`unified_api.py` is the single place where Home Assistant HTTP views for this integration are registered.

It should be called once during integration setup (typically from `__init__.py` / `async_setup_entry`).

---

## Entry point

- `async_register_unified_api(hass) -> None`

Behavior:

- Registers these views (order is not important, but keep it stable):
  - `PingView()`
  - `FrontendManifestView()`
  - `EntitiesScanView()`
  - `CatalogueGetView()`
  - `CatalogueRefreshView()`
  - `CatalogueItemTriageView()`
  - `CatalogueTriageBulkView()`
  - `CatalogueReferenceTotalView()`
  - `SettingsPricingView()`
  - `MetaView()`
  - `MetaSyncPreviewView()`
  - `MetaSyncApplyView()`
  - `EnrichPreviewView()`
  - `EnrichApplyView()`
  - `EnrichDiagnoseView()`
  - `EnrichCleanupView()`
  - `MigrationExportView()`
  - `DashboardOverviewView()`
  - `CostsCompareView()`
  - `DiagnosticCheckView()`

Each view is registered using:

- `hass.http.register_view(ViewInstance)`

---

## Key API contracts

### `POST /catalogue/reference_total`

Purpose:

- set or clear the main reference meter in the persistent catalogue

Current behavior when a reference sensor is saved:

- marks the matching catalogue item as `is_reference_total = true`
- forces `include = false`
- triggers helper creation / helper resolution for that reference sensor immediately
- persists the resulting explicit helper mapping on the catalogue item
- returns an `enrich_reference` payload describing what happened during helper creation/resolution

Important:

- this endpoint does **not** add the reference sensor to `pricing.cost_entity_ids`
- the reference gets helpers for overview/reference computations, not because it becomes a measured-cost sensor

### `POST /enrich/apply`

Purpose:

- create or discover helper entities for selected source sensors
- persist the explicit `derived.helpers.energy` mapping back into catalogue items

Current behavior:

- works from the requested `entity_ids`, or falls back to the pricing selection when none is supplied
- when no explicit `entity_ids` are supplied, it also appends the current reference sensor so the default enrichment flow covers it
- creates or reuses the integration helper (`*_kwh_total`) and utility-meter helpers (`*_kwh_day|week|month|year`)
- writes the resolved helper entity_ids into the matching catalogue item

### `GET /dashboard`

Purpose:

- compute overview data from the catalogue, pricing settings, live power states, and persisted helper mappings

Current behavior:

- resolves selected measured sensors from pricing
- resolves the reference sensor from the catalogue flag `is_reference_total`
- sends catalogue items to the shared cost engine so calculations can use explicit helper mappings first
- only falls back to name-derived helper resolution for migration compatibility

### `POST /costs/compare`

Purpose:

- compare energy consumption and cost between two time periods using recorder statistics

Current behavior:

- reads `pricing.cost_entity_ids` and the current reference sensor from the catalogue
- resolves energy data from `recorder.statistics_during_period` on the `*_kwh_total` helper of each sensor
- supports 4 presets: `today_vs_yesterday`, `this_week_vs_last_week`, `this_weekend_vs_last_weekend`, `custom_periods`
- degrades gracefully per sensor if recorder statistics are missing (warnings instead of hard failure)
- week start is configurable via `week_mode` (`classic` = Monday, `custom` + `custom_week_start` JS weekday index)

Request body:

```json
{
  "preset": "today_vs_yesterday",
  "tax_mode": "ttc",
  "week_mode": "classic",
  "custom_week_start": 5,
  "reference_range": { "start": "<ISO>", "end": "<ISO>" },
  "compare_range": { "start": "<ISO>", "end": "<ISO>" }
}
```

Response shape:

```json
{
  "ok": true,
  "supported": true,
  "meta": { "preset_used": "...", "resolved_reference_range": {...}, "resolved_compare_range": {...}, ... },
  "reference_period": { "reference": {...}, "internal": {...}, "delta": {...} },
  "compare_period": { "reference": {...}, "internal": {...}, "delta": {...} },
  "summary": { "reference": {...}, "internal": {...}, "delta": {...} },
  "per_sensor": [ { "entity_id": "...", "name": "...", "reference_period": {...}, "compare_period": {...}, "delta": {...} } ],
  "pricing": {...},
  "warnings": [...]
}
```

- `reference_period` / `compare_period` each contain:
  - `reference`: main meter (reference sensor) row
  - `internal`: sum of measured cost sensors
  - `delta`: difference (reference − internal)
- `per_sensor`: sorted by `delta.total_{tax_mode}` descending
- `supported: false` if ranges could not be resolved

### `POST /diagnostic/check`

Purpose:

- detect catalogue inconsistencies and config entry health issues

See `docs/api/diagnostic_check.md` for full documentation.

---

## Contract: adding a view

When adding a new API view:

1) Implement a `HomeAssistantView` subclass in `custom_components/hse/api/views/...`.
2) Ensure:
   - `url` is under the integration prefix (see `const.API_PREFIX`).
   - `requires_auth` is correct.
   - Responses are JSON and stable (avoid breaking changes to keys).
3) Import the view class here and register it.
4) Add/update the corresponding doc in `custom_components/hse/docs/`.

---

## Human checklist

If an endpoint returns 404:

1) Confirm the integration is loaded.
2) Confirm `async_register_unified_api()` is called during setup.
3) Check HA logs for startup exceptions.

If `POST /catalogue/reference_total` succeeds but the reference still has only `hour` populated in overview:

1) Inspect the response payload and check `enrich_reference`.
2) Verify the reference power sensor has a numeric live state at save time.
3) Confirm the helper entities `*_kwh_total`, `*_kwh_day`, `*_kwh_week`, `*_kwh_month`, `*_kwh_year` exist or were created.
4) Check the catalogue item for `derived.helpers.energy` persistence.

If `POST /enrich/apply` does not enrich the reference sensor:

1) Check whether the caller sent explicit `entity_ids`.
2) Remember that automatic reference append only happens when `entity_ids` are omitted.
3) Use `catalogue/reference_total` save flow for the immediate reference-helper creation path.

If `POST /costs/compare` returns `supported: false`:

1) Check `warnings` array for `pricing_not_configured` or `pricing_has_no_cost_entity_ids`.
2) Verify the preset name is one of the 4 supported values.
3) For `custom_periods`, ensure both `reference_range` and `compare_range` contain valid ISO timestamps.

If an endpoint returns 401:

1) Confirm `requires_auth = True` is intended.
2) Confirm frontend/API caller includes a valid HA token.
