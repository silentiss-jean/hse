# Constants — `const.py`

Target file:

- `custom_components/hse/const.py`

AI-first: list constants and what they affect.
Human layer: safe change checklist.

---

## Purpose

Defines shared constants used across the integration.

Typical examples:

- `DOMAIN`
- API prefixes / route fragments
- Defaults
- Service names

---

## Maintenance notes

Changing constants can be breaking if:

- a constant is part of a URL (`API_PREFIX`),
- a constant is used for entity_id naming,
- a constant is used as a storage key.

---

## Human checklist

Before renaming a constant used externally:

1) Search for usages.
2) Consider migrations for stored data.
3) Update docs and frontend callers.
