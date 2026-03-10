# Themes tokens (shadow) — `hse_themes.shadow.css`

Target file:

- `custom_components/hse/web_static/shared/styles/hse_themes.shadow.css`

AI-first: theme keys and required variable contract.
Human layer: adding a theme safely.

---

## Purpose

Defines theme-specific CSS variables for the HSE panel.

Selection model:

- Theme is chosen by setting an attribute on the shadow host:
  - `:host([data-theme="<key>"])`

This file is expected to be injected into the panel shadow DOM (see `hse_panel.js`).

---

## Theme keys (contract)

The theme keys must match what the UI offers / stores in localStorage.

Common keys in this file:

- `light`, `dark`, `ocean`, `forest`, `sunset`, `minimal`, `neon`, `aurora`

If you add a key, update the customisation UI and any manifest mapping.

---

## Variables expected by the UI

This file provides the base semantic palette:

- Surfaces: `--hse-bg`, `--hse-bg-secondary`, `--hse-surface`, `--hse-surface-muted`
- Borders: `--hse-border`, `--hse-border-soft`, `--hse-border-strong`
- Text: `--hse-text`, `--hse-text-muted`, `--hse-text-soft`, `--hse-text-inverse`
- Accents and states: `--hse-primary`, `--hse-accent`, `--hse-info`, `--hse-success`, `--hse-warning`, `--hse-error`
- Gradients: `--hse-gradient-*`
- Badge tokens: `--hse-badge-bg`, `--hse-badge-border`, `--hse-badge-fg`
- Dynamic background: `--hse-bg-dynamic`, `--hse-bg-dynamic-opacity`
- Shadows/radius: `--hse-shadow-*`, `--hse-radius-*`

Other files (like `hse_tokens.shadow.css` and `tokens.css`) build components on top of these.

---

## Human checklist

When adding a new theme:

1) Duplicate a theme block and change values; keep variable names identical.
2) Confirm `color-scheme` is correct (light vs dark).
3) Verify contrast for `--hse-text` over `--hse-surface`.
4) Ensure `--hse-on-header` / `--hse-on-accent` matches header gradient brightness.
