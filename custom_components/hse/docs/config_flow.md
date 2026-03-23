# Config flow — `config_flow.py`

Target file:

- `custom_components/hse/config_flow.py`

AI-first: what steps exist, what data is collected, and what entry/options are created.
Human layer: troubleshooting.

---

## Purpose

Implements the Home Assistant config flow (UI setup) for the integration.

This is where:

- user inputs are collected,
- config entries are created,
- options flows are implemented (if present).

---

## Things to document when editing

- Step IDs and their order.
- Input schema fields and defaults.
- Validation / connectivity checks.
- What is stored in the config entry data vs options.

---

## Human checklist

If onboarding fails:

1) Look for exceptions in HA logs during the flow.
2) Verify the schema matches what setup expects.
3) Verify you didn't rename options without migration.
