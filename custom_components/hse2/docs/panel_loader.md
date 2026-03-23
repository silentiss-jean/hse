# Panel core loader — `loader.js`

Target file:

- `custom_components/hse/web_static/panel/core/loader.js`

AI-first: exported functions and rules.
Human layer: troubleshooting + extension checklist.

---

## Purpose

Provide two small primitives used by the panel to load assets:

- `load_script_once(url)` to dynamically load JS without duplicates.
- `load_css_text(url)` to fetch CSS as text (for injection into shadow DOM).

This module exports into the global namespace:

- `window.hse_loader`

---

## Public API

### `window.hse_loader.load_script_once(url) -> Promise<void>`

Rules:

1) Deduplication is based on exact URL string; already loaded URLs are stored in a module-level `Set`.
2) Script element is appended to `document.head` with `async=true`.
3) Success is resolved on `script.onload`.
4) Failure rejects with `Error("script_load_failed: <url>")`.

Implications:

- Cache-busting query strings (e.g. `?v=...`) create distinct URLs and will load again.

### `window.hse_loader.load_css_text(url) -> Promise<string>`

Rules:

1) Uses `fetch(url, { cache: "no-store" })`.
2) If `resp.ok` is false, throws `Error("css_load_failed: <url> (<status>)")`.
3) Returns `resp.text()`.

Implications:

- CSS is expected to be injected by the caller (typically into `<style>` within shadow DOM).

---

## Usage scenarios

### Scenario A — Normal boot

- Panel calls `load_script_once()` for shared UI helpers then feature views.
- Panel calls `load_css_text()` for shadow styles, concatenates them into a `<style>` block.

### Scenario B — Asset load error

- A 404 on static hosting will show up as `css_load_failed` or `script_load_failed`.
- The panel boot code should catch and render an error view.

---

## Human checklist

If the panel is blank:

1) Open browser devtools console and look for `script_load_failed`.
2) Open network tab and confirm requested static URLs return 200.
3) Verify cache-buster `v=` matches backend static versioning.
