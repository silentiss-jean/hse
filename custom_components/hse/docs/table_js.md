# Shared table renderer — `table.js`

Target file:

- `custom_components/hse/web_static/shared/ui/table.js`

AI-first: data contract and rendering rules.
Human layer: extension patterns and pitfalls.

---

## Purpose

Render a simple HTML table using the shared `hse_dom` helpers.

Exports:

- `window.hse_table`

---

## Public API

### `window.hse_table.render_table(container, columns, rows) -> void`

Inputs:

- `container`: DOM node to fill.
- `columns`: array of objects with:
  - `label` (string): column header.
  - `get_value(row)`: function that returns a value for the cell.
- `rows`: array of arbitrary row objects.

Rules:

1) Clears the container.
2) Creates `<table class="hse_table">`.
3) Creates `<thead>` from `columns[].label`.
4) Creates `<tbody>` by iterating rows and columns.
5) Cell rendering:
   - if `value` is `undefined` or `null`: renders `—`
   - else: `String(value)`

---

## Usage example

Columns:

- `[{ label: "name", get_value: (r)=>r.name }, { label: "total", get_value:(r)=>r.total }]`

Rows:

- `[{ name: "foo", total: 12 }, { name: "bar", total: 7 }]`

---

## Human checklist

If the table is empty:

1) Confirm `rows` is an array (not null/undefined).
2) Confirm each column has a `get_value` function.
3) Confirm CSS for `.hse_table` is loaded in the panel.
