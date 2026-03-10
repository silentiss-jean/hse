# Base tokens (shadow) — `hse_tokens.shadow.css`

Target file:

- `custom_components/hse/web_static/shared/styles/hse_tokens.shadow.css`

AI-first: token catalogue and layering rules.
Human layer: how to extend safely.

---

## Purpose

Defines the baseline semantic tokens for the HSE UI.

Layering model:

1) `hse_tokens.shadow.css`: fallback values for all semantic variables.
2) `hse_themes.shadow.css`: overrides tokens per theme via `:host([data-theme=...])`.
3) `hse_alias.v2.css`: compatibility aliases between naming schemes.
4) `tokens.css`: component/utility classes consuming those variables.

This file is expected to be injected into the panel shadow DOM.

---

## What belongs here

- Variable definitions that features and component styles rely on.
- Fallback values that make the UI readable even without theme overrides.

What does NOT belong here:

- Component class selectors (those belong to `tokens.css`).
- Page layout rules tied to DOM structure (those belong to the panel CSS / tokens.css).

---

## Token categories

### Typography

- `--hse-font-family`, `--hse-mono-font-family`, `--hse-font-tracking`
- Sizes/weights: `--hse-font-size-*`, `--hse-font-weight-*`

### Surfaces / borders / text

- `--hse-bg`, `--hse-bg-secondary`, `--hse-surface`, `--hse-surface-muted`
- `--hse-border`, `--hse-border-soft`, `--hse-border-strong`
- `--hse-text`, `--hse-text-muted`, `--hse-text-soft`, `--hse-text-inverse`

### Semantic palette

- `--hse-primary`, `--hse-accent`, `--hse-info`, `--hse-success`, `--hse-warning`, `--hse-error`
- Dark variants and soft backgrounds.

### Gradients and on-colors

- `--hse-gradient-*`
- `--hse-on-accent`, `--hse-on-header`

### Shadows / motion / radius / spacing

- `--hse-shadow-*`, `--hse-transition-*`, `--hse-radius-*`, `--hse-spacing-*`

### Dynamic background

- `--hse-bg-dynamic`, `--hse-bg-dynamic-opacity`

---

## Human checklist

When adding a new token:

1) Add it here with a sane fallback.
2) Decide if it needs per-theme overrides in `hse_themes.shadow.css`.
3) Decide if it needs an alias in `hse_alias.v2.css`.
4) Use it in `tokens.css` (or a feature stylesheet) only after 1–3 are done.
