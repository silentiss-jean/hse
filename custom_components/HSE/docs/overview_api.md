# Feature API — overview — `overview.api.js`

Target file:

- `custom_components/hse/web_static/panel/features/overview/overview.api.js`

AI-first: what endpoints it calls and what it returns.
Human layer: troubleshooting.

---

## Purpose

Frontend API wrapper for the Overview feature.

Document:

- request URLs,
- parameters,
- expected response shapes.

---

## Human checklist

If overview data is empty:

1) Confirm endpoint is reachable (curl).
2) Check auth/token handling in panel.
3) Inspect network responses.
