# Time utilities — `time_utils.py`

Target file:

- `custom_components/hse/time_utils.py`

HSE_DOC declared in source: `persistent_catalogue.md` (triage/health timestamps).

---

## Purpose

Provides thin UTC time helpers used consistently across the HSE backend. All timestamps persisted in the catalogue and workflow slots use UTC ISO 8601 format produced by this module.

---

## Functions

### `utc_now() -> datetime`

Returns the current UTC datetime with timezone info (`timezone.utc`).

### `utc_now_iso() -> str`

Returns the current UTC datetime as an ISO 8601 string.

Example output: `"2026-03-27T16:00:00.123456+00:00"`

Used in: all workflow slot timestamps (`started_at`, `updated_at`, `finished_at`), catalogue health fields (`first_unavailable_at`, `last_ok_at`), helper mapping `last_resolved_at`.

### `parse_iso(ts: str | None) -> datetime | None`

Parses an ISO 8601 string back to a datetime. Returns `None` on failure or if input is empty/None.

Compatible with Python 3.11+ `fromisoformat` (handles UTC offset notation).

### `seconds_since(ts: str | None) -> int | None`

Returns the number of seconds elapsed since the given ISO timestamp. Returns `None` if the timestamp is missing or unparseable.

Used in: catalogue health escalation logic (compare against `CATALOGUE_OFFLINE_GRACE_S`).

---

## Convention

- All timestamps stored in the catalogue **must** use `utc_now_iso()` — never use `datetime.now()` without timezone.
- Consumers that need to display timestamps in local time must convert after reading from the catalogue.
