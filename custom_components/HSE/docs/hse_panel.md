# Panel entrypoint web component — `hse_panel.js`

Target file:

- `custom_components/hse/web_static/panel/hse_panel.js`

AI-first: boot sequence, state model, action dispatch.
Human layer: scenarios and debugging checklist.

---

## Purpose

Defines the custom element `<hse-panel>` (shadow DOM) used by Home Assistant to render the integration panel.

Responsibilities:

- Boot: load shared JS + feature modules + shadow CSS.
- Render: create shell and mount feature views.
- State: persist UI state in `localStorage`.
- Actions: dispatch user actions from feature views (scan/custom/overview).

---

## Public contract

- Custom element name: `hse-panel`.
- Expects Home Assistant to set `element.hass = hass`.
- Uses global helpers loaded at runtime:
  - `window.hse_loader`, `window.hse_dom`, `window.hse_table`, `window.hse_shell`
  - feature modules: `window.hse_overview_api/view`, `window.hse_scan_api/view`, `window.hse_custom_view`

---

## Boot sequence (decision order)

Entry: `connectedCallback()`

1) Early return if already initialized (`this._root`).
2) Store a build signature for debugging:
   - console info
   - `window.__hse_panel_loaded = build_signature`
3) Load persisted UI preferences:
   - `hse_theme`
   - `hse_custom_dynamic_bg`
   - `hse_custom_glass`
   - `hse_active_tab`
   - scan UI state: `hse_scan_groups_open`, `hse_scan_open_all`
4) Create shadow root: `this.attachShadow({ mode: "open" })`.
5) Start async `_boot()`.

Boot: `_boot()`

1) Ensures `window.hse_loader` exists (fallback inline implementation).
2) Loads scripts (in order):
   - shared UI: `dom.js`, `table.js`
   - core: `shell.js`
   - features: `overview.*`, `scan.*`, `custom.view.js`
3) Loads CSS text (in order):
   - `hse_tokens.shadow.css`
   - `hse_themes.shadow.css`
   - `hse_alias.v2.css`
   - `tokens.css`
4) Injects everything in shadow DOM as a single `<style>` block and a `<div id="root">`.
5) On error, renders a minimal "Boot error" UI.

Cache-busting:

- `ASSET_V` is appended as `?v=<ASSET_V>`.
- Must match backend cache-buster (`const.py` / `PANEL_JS_URL`).

---

## Rendering model

Main renderer: `_render()`

Preconditions:

- Shadow root exists.
- `#root` exists.
- `window.hse_shell` and `window.hse_dom` are loaded.

Flow:

1) Create shell once with `create_shell()` and keep refs in `this._ui`.
2) Update header right label with current user name.
3) Ensure active tab is valid (`_ensure_valid_tab()`).
4) Render nav tabs (`_render_nav_tabs()`).
5) Clear content.
6) If `hass` is missing: show "En attente de hass…".
7) Switch on `this._active_tab`:
   - `overview` -> `_render_overview()`
   - `scan` -> `_render_scan()`
   - `custom` -> `_render_custom()`
   - default -> placeholder

---

## State persistence

Storage helper methods:

- `_storage_get(key)` and `_storage_set(key,value)` wrap `localStorage` with try/catch.

Stored keys:

- `hse_theme`
- `hse_custom_dynamic_bg`
- `hse_custom_glass`
- `hse_active_tab`
- `hse_scan_groups_open` (JSON)
- `hse_scan_open_all` (`"0"|"1"`)

---

## Feature action handling

### Scan feature

Delegate: `window.hse_scan_view.render_scan(container, scan_result, scan_state, callback)`.

Actions handled:

- `filter`: updates `scan_state.filter_q`.
- `set_group_open`: updates `scan_state.groups_open[id]` and persists JSON.
  - supports `{ no_render: true }` to avoid full rerender.
- `open_all`: sets `open_all=true` and persists.
- `close_all`: clears `open_all` and resets `groups_open`.
- `scan`: calls `window.hse_scan_api.fetch_scan(hass, { include_disabled:false, exclude_hse:true })` and stores results.

### Overview feature

- Loads data on button click using `window.hse_overview_api.fetch_manifest_and_ping(hass)`.

### Custom feature

- `set_theme`: sets host `data-theme` attribute + persists.
- `toggle_dynamic_bg`: updates CSS var `--hse-bg-dynamic-opacity`.
- `toggle_glass`: updates CSS var `--hse-backdrop-filter`.

---

## Usage scenarios

### Scenario A — Boot error

Symptoms:

- Panel shows "Boot error".

Likely causes:

- Static hosting 404.
- JS module load order mismatch.

### Scenario B — Tab renamed in `shell.js`

Symptoms:

- Clicking tab does nothing or shows placeholder.

Fix:

- Align `shell.js get_nav_items()` ids with `_render()` switch cases.

### Scenario C — Cache/version mismatch

Symptoms:

- Old JS served after update.

Fix:

- Bump `ASSET_V` and ensure backend `PANEL_JS_URL` cache-buster matches.

---

## Human checklist

1) Open devtools console: check for `script_load_failed` / `css_load_failed`.
2) Confirm `ASSET_V` matches `PANEL_JS_URL` version.
3) Confirm all `window.hse_*` globals exist after boot.
4) Inspect `localStorage` keys if UI state behaves unexpectedly.
