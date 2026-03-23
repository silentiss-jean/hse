# Scan UI (frontend) — `scan.view.js`

This document describes how the HSE panel "Détection" scan UI renders the backend scan results.

Target file:

- `custom_components/hse/web_static/panel/features/scan/scan.view.js`

This is formatted **AI-first** (explicit rules, decision order, fields), with a human layer (scenarios, interpretation, checklist).

---

## Purpose

Render a "scan" page that helps users identify candidate **power/energy sensors** to use as source entities, grouped by integration.

The UI:

- Displays an action toolbar (scan button, search filter, open/close all).
- Displays integration-level summary counts.
- Displays per-candidate badges describing semantics (`kind`, `unit`, `state_class`) and health (`status`, `state`).

---

## Inputs

The main entry point is:

- `render_scan(container, scan_result, state, on_action)`

Parameters:

- `container`: DOM element where the view is rendered.
- `scan_result`: JSON returned by the backend scan endpoint.
  - `scan_result.integrations[]`
  - `scan_result.candidates[]`
- `state`: local UI state, expected fields:
  - `scan_running` (bool)
  - `filter_q` (string)
  - `open_all` (bool)
  - `groups_open` (object map integration_domain -> bool)
- `on_action(type, payload?)`: callback to the controller/state manager.

External utilities:

- `window.hse_dom.el(tag, className?, text?)`
- `window.hse_dom.clear(node)`
- `window.hse_table.render_table(container, columns, rows)`

---

## Filtering logic

Function: `_filter_candidates(candidates, q)`

- If `q` is empty: returns all candidates.
- Else: performs a case-insensitive substring match against a concatenated "haystack":

Fields included in the haystack:

- `entity_id`
- `name`
- `integration_domain`
- `kind`
- `unit`
- `state_class`
- `status`
- `ha_state`

Implication:

- Filtering works for both registry-level status (e.g. `not_provided`) and runtime state (e.g. `unavailable`).

---

## Grouping logic

Function: `_group_by_integration(candidates)`

- Groups by `integration_domain` (fallback to `"unknown"`).
- Computes per-group counts: total, power, energy.
- Sort order:
  1) `total` desc
  2) `integration_domain` asc

Rendering:

- Each group is a `<details>` fold.
- Fold open state:
  - If `state.open_all` is true: all groups are opened.
  - Else: uses `state.groups_open[integration_domain]`.
- Lazy rendering:
  - Candidate list inside the fold is built on first open (`body.dataset.loaded`).

---

## Badge rules

Badges are rendered in `_render_candidate_list()`.

### Always present

- `kind` badge: `power|energy` (or `—`).

### Registry status badge

Rendered when `c.status` exists.

- Text: `status: <label>` where label mapping is:
  - `ok` -> `ok`
  - `disabled` -> `disabled`
  - `not_provided` -> `not provided`
  - else: raw string
- CSS class: `_status_class(status)`
  - `ok` -> `.hse_badge_status_ok`
  - `not_provided` or `disabled` -> `.hse_badge_status_warn`
  - else -> no special class
- Tooltip:
  - if `c.status_reason` exists -> `title = status_reason`

Note:

- This badge is about entity registry / provisioning.

### Runtime state badge

Rendered when `c.ha_state` exists.

- Text: `state: <ha_state>`
- CSS class: `_ha_state_class(ha_state, ha_restored)`
  - `ha_state in {unavailable, unknown}` -> warn
  - OR `ha_restored == true` -> warn
- Tooltip:
  - if `ha_restored` -> `title = "restored: true"`

Note:

- This badge is about runtime health.

### Metadata badges

Rendered when present:

- `unit`
- `state_class`
- `disabled_by`: rendered as `disabled: <value>` with `.hse_badge_warn`

---

## Error handling

If `scan_result.error` is present:

- renders a `<pre>` block containing the error and stops.

---

## Scenarios

### Scenario A — Healthy live sensor

Expected UI:

- `status: ok` (ok styling)
- `state: <numeric>` (neutral styling)

### Scenario B — Orphaned/not provided entity

Expected UI:

- `status: not provided` (warn styling)
- `state: unavailable` (warn styling)
- runtime tooltip often shows `restored: true`

### Scenario C — Temporarily offline device

Expected UI:

- `status: ok` (registry ok)
- `state: unavailable` (warn)
- `restored` may be false

Interpretation:

- Likely a device/integration runtime issue; not necessarily safe to delete.

---

## Human checklist

When UI looks inconsistent:

1) Confirm backend payload includes `status/status_reason` and `ha_state/ha_restored`.
2) Use filter box to search for `unavailable`, `not provided`, integration name, or entity_id.
3) Open the group fold to ensure candidate list is rendered (lazy load).
4) Hover status badges to see tooltips.

---

## Maintenance note (IMPORTANT)

If you change any of these in the backend scan payload, update this doc:

- Candidate fields (e.g. rename `ha_state`, `ha_restored`, `status_reason`).
- Status semantics (`ok/disabled/not_provided/...`).
- Grouping key (`integration_domain`).

