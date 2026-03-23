# Shared DOM helpers — `dom.js`

Target file:

- `custom_components/hse/web_static/shared/ui/dom.js`

AI-first: exported functions and safety rules.
Human layer: usage patterns.

---

## Purpose

Provide minimal DOM helpers used across the panel without pulling any framework.

Exports:

- `window.hse_dom`

---

## Public API

### `window.hse_dom.el(tag, class_name?, text?) -> HTMLElement`

Rules:

- Creates an element via `document.createElement(tag)`.
- If `class_name` is provided, assigns `node.className = class_name`.
- If `text` is not `undefined`/`null`, sets `node.textContent = String(text)`.

Security note:

- Uses `textContent` (not `innerHTML`), so it is safe for untrusted text.

### `window.hse_dom.clear(node) -> void`

Rules:

- Removes all child nodes.

---

## Usage scenarios

### Scenario A — Rendering a view

- Create DOM nodes with `el()`.
- Clear containers with `clear()` on rerender.

### Scenario B — Styling

- Pass class names corresponding to `tokens.css` primitives (e.g. `hse_card`, `hse_toolbar`).

---

## Human checklist

If UI doesn't update:

1) Check callers are clearing the correct container.
2) Check `window.hse_dom` is loaded before views (boot order).
