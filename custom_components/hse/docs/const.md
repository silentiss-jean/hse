# Constants — `const.py`

Target file:

- `custom_components/hse/const.py`

AI-first: list constants and what they affect.
Human layer: safe change checklist.

---

## Purpose

Defines shared constants used across the integration.

---

## Current constants

### Identity

- `DOMAIN = "hse"` — key used for `hass.data[DOMAIN]`, config entry domain, issue registry domain.

### API routing

- `API_PREFIX = "/api/hse/unified"` — prefix for all unified HTTP API endpoints.
- `STATIC_URL = "/api/hse/static"` — base URL for static file serving (JS panel, assets).

### Panel

- `PANEL_URL_PATH = "hse"` — sidebar path in Home Assistant UI.
- `PANEL_TITLE = "Home Suivi Elec v2"` — sidebar label.
- `PANEL_ICON = "mdi:flash"` — sidebar icon.
- `PANEL_JS_URL = "{STATIC_URL}/panel/hse_panel.js?v=0.1.51"` — versioned JS bundle URL served to the frontend.
- `PANEL_ELEMENT_NAME = "hse-panel"` — custom element name registered by the JS bundle.

### Intervals

- `CATALOGUE_REFRESH_INTERVAL_S = 600` — catalogue background refresh interval (10 min).
- `CATALOGUE_OFFLINE_GRACE_S = 900` — grace period before marking an entity degraded when it stays unavailable/unknown (15 min).
- `META_SYNC_INTERVAL_S = 600` — meta (rooms/types) continuous sync interval (10 min).

---

## Maintenance notes

Changing constants can be breaking if:

- a constant is part of a URL (`API_PREFIX`, `STATIC_URL`, `PANEL_JS_URL`) — frontend callers will break.
- a constant is used for entity_id naming — stored helper references will be stale.
- a constant is used as a storage key (`DOMAIN`) — persisted catalogue data will become unreachable.
- `PANEL_ELEMENT_NAME` changes — the registered custom element won't match what the panel tries to load.

### Bumping `PANEL_JS_URL` version

Change only the `?v=X.Y.Z` query string. This forces browsers to bypass cache on next load. Do **not** change the path prefix.

### Changing intervals

`CATALOGUE_REFRESH_INTERVAL_S` and `META_SYNC_INTERVAL_S` affect background task scheduling. Changes take effect only after HA restart or integration reload.

`CATALOGUE_OFFLINE_GRACE_S` affects health escalation timing. Lowering it will trigger Repairs issues sooner.

---

## Human checklist

Before renaming a constant used externally:

1. Search all usages across `custom_components/hse/`.
2. Check frontend JS sources for string references to URLs or element names.
3. Consider migrations for stored data if `DOMAIN` changes.
4. Update this doc and any impacted endpoint docs.
