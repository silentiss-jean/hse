# Integration entrypoint — `__init__.py`

Target file:

- `custom_components/hse/__init__.py`

AI-first: what is set up here, when it runs, and what it registers.
Human layer: common failure modes.

---

## Purpose

This module is the integration entrypoint used by Home Assistant to set up and tear down the integration.

Typical responsibilities (depending on implementation):

- Define `async_setup`, `async_setup_entry`, `async_unload_entry`.
- Register platforms.
- Initialize shared coordinators / data stores.
- Register HTTP views / websocket commands (directly or indirectly).

---

## Key behaviors to keep in sync

- If this file calls API registration helpers, ensure docs for those helpers are updated.
- If setup/unload changes data structures, ensure dependent modules (API/views/UI) still match.

---

## Human checklist

If the integration doesn't load:

1) Check HA logs for errors during `async_setup_entry`.
2) Confirm dependencies and `manifest.json` are correct.
3) Confirm migrations (if any) and storage formats are compatible.
