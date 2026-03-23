# Panel stylesheet — `style.hse.panel.css`

Target file:

- `custom_components/hse/web_static/panel/style.hse.panel.css`

AI-first: variables and selectors that are part of the panel contract.
Human layer: common pitfalls and change checklist.

---

## Purpose

Defines panel-level CSS primitives used by the HSE panel.

Note:

- In the current codebase, the panel also loads `shared/styles/tokens.css` into shadow DOM.
- This file is only useful if explicitly loaded by the boot sequence / manifest.

---

## Variables (contract)

Defined on `:host`:

- `--hse_gap`, `--hse_radius`
- `--hse_bg`, `--hse_fg`, `--hse_muted`, `--hse_border`
- `--hse_card_bg`, `--hse_code_bg`
- `--hse_accent`, `--hse_danger`

These variables are consumed by classes below (and possibly by JS-driven overrides).

---

## Key selectors

- `.hse_page`, `.hse_shell`, `.hse_header`, `.hse_title`, `.hse_subtitle`
- `.hse_tabs`, `.hse_tab`
- `.hse_card`, `.hse_toolbar`, `.hse_button`, `.hse_button_primary`, `.hse_input`
- `.hse_badges`, `.hse_badge`
- `.hse_table`, `.hse_code`

---

## Known issue

The selector `.hse_tab[data_active="true"]` uses an underscore and does **not** match the JS code that sets `data-active="true"` (hyphen) on tabs.

If this stylesheet is used, active tab styling will not apply unless you change it to:

- `.hse_tab[data-active="true"]`

(Apply only if this CSS is actually loaded; otherwise prefer fixing the shared `tokens.css` / used stylesheet.)

---

## Human checklist

1) Verify this CSS is actually loaded into the shadow DOM.
2) Verify data-attribute selectors match DOM (`data-active` vs `data_active`).
3) Avoid duplicating primitives already in `shared/styles/tokens.css`.
