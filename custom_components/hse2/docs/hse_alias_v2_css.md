# Shadow CSS aliases — `hse_alias.v2.css`

Target file:

- `custom_components/hse/web_static/shared/styles/hse_alias.v2.css`

AI-first: alias map contract.
Human layer: migration notes.

---

## Purpose

Provide compatibility aliases from an older variable naming scheme to a newer one.

This file is intended to be injected into the panel shadow DOM.

---

## Alias mapping

Defined on `:host`:

- `--hse_border` -> `--hse-border`
- `--hse_muted` -> `--hse-text-muted`
- `--hse_card_bg` -> `--hse-surface`
- `--hse_danger` -> `--hse-error`
- `--hse_accent` -> `--hse-accent`
- `--hse_gap` -> `--hse-spacing-md`
- `--hse_radius` -> `--hse-radius-lg`

---

## Human checklist

1) If you introduce new tokens in `hse_tokens.shadow.css`, decide whether they need a v1 alias.
2) Keep aliases minimal; avoid creating two sources of truth.
3) Verify final computed values in devtools (shadow host styles).
