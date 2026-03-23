# Feature view — overview — `overview.view.js`

Target file:

- `custom_components/hse/web_static/panel/features/overview/overview.view.js`

AI-first: rendering rules and state/action contract.
Human layer: scenarios.

---

## Purpose

Renders the "overview" section of the panel.

Document:

- which data blocks are shown,
- which derived computations exist (if any),
- error/empty states.

---

## Human checklist

If numbers look wrong:

1) Inspect the raw payload returned by `overview.api.js`.
2) Verify units and rounding.
3) Check timezone/cycle boundaries.
