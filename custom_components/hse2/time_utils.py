"""
HSE_DOC: custom_components/hse/docs/persistent_catalogue.md
HSE_MAINTENANCE: If you change triage/health schema or refresh rules, update the doc above.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        # Python 3.11: fromisoformat supports offsets.
        return datetime.fromisoformat(ts)
    except Exception:
        return None


def seconds_since(ts: str | None) -> int | None:
    dt = parse_iso(ts)
    if not dt:
        return None
    return int((utc_now() - dt).total_seconds())
