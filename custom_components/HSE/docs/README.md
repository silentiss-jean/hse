# Docs index & maintenance convention

This folder contains documentation meant to stay **close to the code**.

The project uses a standardized header in source files so that both humans and AI agents can quickly locate the right doc and know when it must be updated.

---

## Standard header

Every documented file should start with a short header block:

### Python

```py
"""
HSE_DOC: custom_components/hse/docs/<name>.md
HSE_MAINTENANCE: If you change public behavior/fields/rules here, update the doc above.
"""
```

### JS / CSS

```js
/*
HSE_DOC: custom_components/hse/docs/<name>.md
HSE_MAINTENANCE: If you change public behavior/fields/rules here, update the doc above.
*/
```

---

## How to find docs quickly

From HAOS / Linux shell:

```sh
grep -R "^HSE_DOC:" -n custom_components/hse
```

To list all docs:

```sh
ls -1 custom_components/hse/docs
```

---

## What should be documented

Prefer documenting files that define a "surface":

- API endpoints and their payloads.
- Frontend views and controllers.
- Shared UI primitives (DOM helpers, table helpers, tokens).
- Entry points (panel loader/shell) and anything that wires modules together.

Trivial modules can still have a doc stub if they are central to architecture.
