# Manifest — `manifest.json`

Target file:

- `custom_components/hse/manifest.json`

AI-first: what keys matter for runtime.
Human layer: common issues.

---

## Purpose

Home Assistant manifest for the integration.

Important fields (examples):

- `domain`
- `name`
- `version`
- `requirements`
- `dependencies`
- `after_dependencies`
- `config_flow`

---

## Human checklist

If the integration doesn't load:

1) Validate JSON syntax.
2) Ensure `domain` matches `const.DOMAIN`.
3) Check `requirements` install properly.
