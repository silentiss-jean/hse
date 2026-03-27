# API — `frontend_manifest`

Target file:

- `custom_components/hse/api/views/frontend_manifest.py`

---

## Endpoint

```
GET /api/hse/unified/frontend_manifest
```

Requires auth: yes.

---

## Purpose

Exposes panel configuration and feature flags to the frontend JS bundle. The frontend reads this on startup to know where to load assets and which features are enabled.

---

## Response

```json
{
  "ok": true,
  "version": "0.1.0",
  "panel": {
    "title": "Home Suivi Elec v2",
    "element_name": "hse-panel",
    "js_url": "/api/hse/static/panel/hse_panel.js?v=0.1.51"
  },
  "static": {
    "url": "/api/hse/static"
  },
  "features": {
    "scan": true,
    "auto_select": false,
    "cost_preview": false
  }
}
```

### Feature flags

| Flag | Current | Meaning |
|---|---|---|
| `scan` | `true` | Entity scan and catalogue available |
| `auto_select` | `false` | Auto-selection of sensors not yet implemented |
| `cost_preview` | `false` | Cost preview before save not yet implemented |

---

## Maintenance notes

- `version` here is an API version, not the integration version. Bump it when the response schema changes.
- Values for `panel.*` and `static.*` are sourced directly from `const.py`. If you change those constants, this response changes automatically.
- Feature flags are hardcoded. When implementing a new feature, set its flag to `true` here and update this doc.
