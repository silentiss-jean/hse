# Panel core shell — `shell.js`

Target file:

- `custom_components/hse/web_static/panel/core/shell.js`

AI-first: DOM contract + navigation model.
Human layer: extension and debugging.

---

## Purpose

Build the top-level panel layout (inside shadow DOM) and provide navigation metadata.

This module exports into the global namespace:

- `window.hse_shell`

---

## Public API

### `window.hse_shell.create_shell(root, ctx) -> { tabs, content, header_right }`

Inputs:

- `root`: DOM node (usually `#root` inside panel shadow DOM).
- `ctx`:
  - `ctx.user_name` (string) is used for the header right text.

Behavior (decision order):

1) Clears `root`.
2) Creates DOM:
   - `.hse_page` (full height container)
   - `.hse_shell` (max width container)
   - `.hse_header` (left title/subtitle + right user)
   - `.hse_tabs` (navigation buttons)
   - `content` div (feature view mount point)
3) Appends nodes and returns references:
   - `tabs`: node where tabs buttons are rendered.
   - `content`: node where feature views should render.
   - `header_right`: node for user label updates.

### `window.hse_shell.get_nav_items() -> Array<{id,label}>`

Returns the navigation items for the panel.

Rules:

- `id` is the internal route key expected by `hse_panel.js`.
- `label` is the user-facing string.
- Items are currently static.

### `window.hse_shell.render_tabs(tabs_node, active_tab, on_tab) -> void`

Rules:

- Clears the tabs container.
- For each nav item, renders a button:
  - sets `data-active="true"` when `id === active_tab`
  - calls `on_tab(id)` on click

---

## Usage scenarios

### Scenario A — Tab list changed

- If you add an item in `get_nav_items()`, you must add a case in `hse_panel.js` for that `id`.
- If you remove/rename an item, make sure `hse_panel.js` fallback and stored tab logic stay valid.

### Scenario B — User name updates

- `hse_panel.js` can update `header_right.textContent` as user changes.

---

## Human checklist

If tabs show but clicking does nothing:

1) Verify `hse_panel.js` attaches click handlers or uses `render_tabs()`.
2) Confirm the `id` values match the `switch` cases in `hse_panel.js`.
3) Check console for JS exceptions.
