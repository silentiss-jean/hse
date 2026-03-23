# Feature API — scan — `scan.api.js`

Target file:

- `custom_components/hse/web_static/panel/features/scan/scan.api.js`

AI-first: endpoints called and returned shape.
Human layer: debugging.

---

## Purpose

Frontend API wrapper for the scan feature.

Document:

- scan endpoint URL,
- query params (include_disabled/exclude_hse),
- expected response keys (`integrations`, `candidates`).

---

## Human checklist

If scan returns 401:

1) Check token/auth injection.
2) Verify `requires_auth` on backend view.
