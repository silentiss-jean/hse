# API — `ping`

Target file:

- `custom_components/hse/api/views/ping.py`

---

## Endpoint

```
GET /api/hse/unified/ping
```

Requires auth: yes.

---

## Purpose

Health check endpoint. Confirms the integration HTTP API is loaded and reachable.

---

## Response

```json
{
  "ok": true,
  "api": "unified",
  "version": "0.1.0"
}
```

- `version` reflects the `VERSION` constant defined in `ping.py` (not the integration manifest version).

---

## Usage

Used by the frontend JS panel on load to confirm the backend is available before rendering. If this returns 401 or 404, the panel should surface an error state.
