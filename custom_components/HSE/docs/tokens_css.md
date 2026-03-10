# Shared component tokens — `tokens.css`

Target file:

- `custom_components/hse/web_static/shared/styles/tokens.css`

AI-first: CSS class contract used by panel views.
Human layer: change safety rules.

---

## Purpose

Defines the CSS classes used across the panel (utilities/components).

This file is injected into the panel shadow DOM by `hse_panel.js`.

---

## Variable bridging

`tokens.css` maps the theme token system to the simplified v1 variables used by older panel code:

- `--hse_fg` comes from `--hse-text` with HA fallback.
- `--hse_border` comes from `--hse-border` with HA fallback.
- `--hse_card_bg` comes from `--hse-surface` with HA fallback.
- `--hse_accent` comes from `--hse-primary` with HA fallback.
- `--hse_danger` comes from `--hse-error` with HA fallback.

---

## Core layout

- `.hse_page`: full-height page, owns the dynamic background overlay (`::before`).
- `.hse_shell`: max width container.
- `.hse_header`, `.hse_tabs`, `.hse_tab`.

`data-active` contract:

- Active tabs are detected via `.hse_tab[data-active="true"]`.

---

## Components

- Cards: `.hse_card`, `.hse_toolbar`, `.hse_button`, `.hse_input`.
- Table: `.hse_table`.
- Code blocks: `.hse_code`.
- Badges: `.hse_badges`, `.hse_badge`, `.hse_badge_warn`.
- Status badges: `.hse_badge_status_ok`, `.hse_badge_status_warn`.
- Scan UI: `.hse_groups`, `.hse_fold`, `.hse_fold_summary`, `.hse_candidate_*`.

---

## Human checklist

When changing a selector:

1) Grep for the class in `web_static/panel/` views.
2) Keep backwards compatibility if possible (add new class, keep old one for one release).
3) Verify dynamic background overlay does not block clicks (ensure `pointer-events:none` and sane stacking).
