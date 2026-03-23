"""HSE_DOC: custom_components/hse/docs/unified_api.md

Backend compare endpoint for Analyse de coûts.

This version completes the historical step by using recorder statistics on the
`*_kwh_total` helper when available, which enables:
- today_vs_yesterday
- this_week_vs_last_week
- this_weekend_vs_last_weekend
- custom_periods

If recorder statistics are missing for a sensor, the endpoint degrades
gracefully with warnings instead of hard-failing the full UI.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from functools import partial
from typing import Any

from homeassistant.components.http import HomeAssistantView
from homeassistant.components.recorder import get_instance
from homeassistant.components.recorder.statistics import statistics_during_period

from ...const import API_PREFIX, DOMAIN
from ...shared_cost_engine import build_sensor_cost_snapshot

_SUPPORTED_PRESETS = {
    "today_vs_yesterday",
    "this_week_vs_last_week",
    "this_weekend_vs_last_weekend",
    "custom_periods",
}
_MONTH_DAYS = 30.4375


def _num(value: Any) -> float | None:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _start_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _end_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=23, minute=59, second=59, microsecond=999999)


def _shift_days(dt: datetime, days: int) -> datetime:
    return dt + timedelta(days=days)


def _ensure_tz(dt: datetime, tzinfo) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tzinfo)
    return dt.astimezone(tzinfo)


def _parse_dt(value: str | None, tzinfo) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return _ensure_tz(datetime.fromisoformat(raw), tzinfo)
    except ValueError:
        return None


def _subscription_for_range(pricing: dict[str, Any] | None, start: datetime, end: datetime) -> tuple[float | None, float | None]:
    if not isinstance(pricing, dict):
        return None, None
    monthly = pricing.get("subscription_monthly")
    if not isinstance(monthly, dict):
        return None, None

    ht = _num(monthly.get("ht"))
    ttc = _num(monthly.get("ttc"))
    if ht is None or ttc is None:
        return None, None

    seconds = max((end - start).total_seconds(), 0.0)
    days = seconds / 86400.0
    return ht * (days / _MONTH_DAYS), ttc * (days / _MONTH_DAYS)


def _energy_price_pair(pricing: dict[str, Any] | None) -> tuple[float | None, float | None, str | None]:
    if not isinstance(pricing, dict):
        return None, None, "missing_pricing"
    contract_type = pricing.get("contract_type")
    if contract_type != "fixed":
        return None, None, f"unsupported_contract_type:{contract_type}"
    pair = pricing.get("fixed_energy_per_kwh")
    if not isinstance(pair, dict):
        return None, None, "missing_fixed_energy_per_kwh"
    return _num(pair.get("ht")), _num(pair.get("ttc")), None


def _row_from_kwh(start: datetime, end: datetime, kwh: float | None, pricing: dict[str, Any] | None, *, include_subscription: bool) -> tuple[dict[str, float | None], list[str]]:
    warnings: list[str] = []
    ht_per_kwh, ttc_per_kwh, reason = _energy_price_pair(pricing)
    if reason:
        warnings.append(reason)

    cost_ht = None if kwh is None or ht_per_kwh is None else float(kwh) * float(ht_per_kwh)
    cost_ttc = None if kwh is None or ttc_per_kwh is None else float(kwh) * float(ttc_per_kwh)

    subscription_ht = 0.0
    subscription_ttc = 0.0
    if include_subscription:
        sub_ht, sub_ttc = _subscription_for_range(pricing, start, end)
        if sub_ht is None or sub_ttc is None:
            warnings.append("missing_subscription_monthly")
            subscription_ht = 0.0
            subscription_ttc = 0.0
        else:
            subscription_ht = float(sub_ht)
            subscription_ttc = float(sub_ttc)

    total_ht = None if cost_ht is None else float(cost_ht) + float(subscription_ht or 0.0)
    total_ttc = None if cost_ttc is None else float(cost_ttc) + float(subscription_ttc or 0.0)

    return (
        {
            "kwh": None if kwh is None else float(kwh),
            "cost_ht": None if cost_ht is None else float(cost_ht),
            "cost_ttc": None if cost_ttc is None else float(cost_ttc),
            "subscription_ht": None if not include_subscription and cost_ht is None else float(subscription_ht or 0.0),
            "subscription_ttc": None if not include_subscription and cost_ttc is None else float(subscription_ttc or 0.0),
            "total_ht": total_ht,
            "total_ttc": total_ttc,
        },
        warnings,
    )


def _sub_opt(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return float(a) - float(b)


def _pct(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev in (None, 0):
        return None
    return round(((float(cur) - float(prev)) / float(prev)) * 100.0, 2)


def _summary_delta(cur: dict[str, float | None], prev: dict[str, float | None]) -> dict[str, float | None]:
    return {
        "delta_kwh": _sub_opt(cur.get("kwh"), prev.get("kwh")),
        "pct_kwh": _pct(cur.get("kwh"), prev.get("kwh")),
        "delta_cost_ht": _sub_opt(cur.get("cost_ht"), prev.get("cost_ht")),
        "pct_cost_ht": _pct(cur.get("cost_ht"), prev.get("cost_ht")),
        "delta_cost_ttc": _sub_opt(cur.get("cost_ttc"), prev.get("cost_ttc")),
        "pct_cost_ttc": _pct(cur.get("cost_ttc"), prev.get("cost_ttc")),
        "delta_total_ht": _sub_opt(cur.get("total_ht"), prev.get("total_ht")),
        "pct_total_ht": _pct(cur.get("total_ht"), prev.get("total_ht")),
        "delta_total_ttc": _sub_opt(cur.get("total_ttc"), prev.get("total_ttc")),
        "pct_total_ttc": _pct(cur.get("total_ttc"), prev.get("total_ttc")),
    }


def _delta_row(a: dict[str, float | None], b: dict[str, float | None]) -> dict[str, float | None]:
    cost_ht = _sub_opt(a.get("cost_ht"), b.get("cost_ht"))
    cost_ttc = _sub_opt(a.get("cost_ttc"), b.get("cost_ttc"))
    sub_ht = _sub_opt(a.get("subscription_ht"), b.get("subscription_ht"))
    sub_ttc = _sub_opt(a.get("subscription_ttc"), b.get("subscription_ttc"))
    kwh = _sub_opt(a.get("kwh"), b.get("kwh"))
    total_ht = None if cost_ht is None and sub_ht is None else float(cost_ht or 0.0) + float(sub_ht or 0.0)
    total_ttc = None if cost_ttc is None and sub_ttc is None else float(cost_ttc or 0.0) + float(sub_ttc or 0.0)
    return {
        "kwh": kwh,
        "cost_ht": cost_ht,
        "cost_ttc": cost_ttc,
        "subscription_ht": sub_ht,
        "subscription_ttc": sub_ttc,
        "total_ht": total_ht,
        "total_ttc": total_ttc,
    }


def _catalogue_item_by_source_entity_id(catalogue: dict, entity_id: str) -> dict | None:
    items = (catalogue or {}).get("items") or {}
    if not isinstance(items, dict):
        return None
    for item in items.values():
        if not isinstance(item, dict):
            continue
        src = item.get("source") or {}
        current_entity_id = src.get("entity_id") if isinstance(src, dict) else None
        if current_entity_id == entity_id:
            return item
    return None


def _current_reference_item(catalogue: dict) -> dict | None:
    items = (catalogue or {}).get("items") or {}
    if not isinstance(items, dict):
        return None
    for item in items.values():
        if not isinstance(item, dict):
            continue
        enr = item.get("enrichment") or {}
        if isinstance(enr, dict) and enr.get("is_reference_total") is True:
            return item
    return None


def _current_reference_entity_id(catalogue: dict) -> str | None:
    item = _current_reference_item(catalogue)
    if not isinstance(item, dict):
        return None
    src = item.get("source") or {}
    if isinstance(src, dict):
        eid = src.get("entity_id")
        if isinstance(eid, str) and eid:
            return eid
    return None


def _empty_period_row() -> dict[str, float | None]:
    return {
        "kwh": None,
        "cost_ht": None,
        "cost_ttc": None,
        "subscription_ht": None,
        "subscription_ttc": None,
        "total_ht": None,
        "total_ttc": None,
    }


def _row_ts(row: dict[str, Any], tzinfo) -> datetime | None:
    value = row.get("end") or row.get("start")
    if isinstance(value, datetime):
        return _ensure_tz(value, tzinfo)
    if isinstance(value, str):
        return _parse_dt(value, tzinfo)
    return None


def _row_stat_value(row: dict[str, Any]) -> float | None:
    for key in ("sum", "state", "mean"):
        value = _num(row.get(key))
        if value is not None:
            return value
    return None


async def _history_energy_kwh(hass, statistic_id: str | None, start: datetime, end: datetime) -> tuple[float | None, list[str]]:
    warnings: list[str] = []
    if not statistic_id:
        return None, ["missing_total_helper"]

    query_start = start - timedelta(days=2)
    try:
        job = partial(
            statistics_during_period,
            hass,
            query_start,
            end,
            [statistic_id],
            "hour",
            None,
            {"sum", "state"},
        )
        raw = await get_instance(hass).async_add_executor_job(job)
    except Exception as err:
        return None, [f"statistics_query_failed:{err}"]

    rows = raw.get(statistic_id) if isinstance(raw, dict) else None
    if not isinstance(rows, list) or not rows:
        return None, [f"no_statistics:{statistic_id}"]

    tzinfo = start.tzinfo or datetime.now().astimezone().tzinfo
    baseline = None
    endpoint = None

    for row in rows:
        if not isinstance(row, dict):
            continue
        ts = _row_ts(row, tzinfo)
        if ts is None:
            continue
        value = _row_stat_value(row)
        if value is None:
            continue
        if ts <= start:
            baseline = value
        if ts <= end:
            endpoint = value

    if baseline is None:
        first = next((r for r in rows if isinstance(r, dict) and _row_stat_value(r) is not None), None)
        baseline = None if first is None else _row_stat_value(first)
        if baseline is not None:
            warnings.append(f"baseline_approximated:{statistic_id}")
    if endpoint is None:
        last = next((r for r in reversed(rows) if isinstance(r, dict) and _row_stat_value(r) is not None), None)
        endpoint = None if last is None else _row_stat_value(last)
        if endpoint is not None:
            warnings.append(f"endpoint_approximated:{statistic_id}")

    if baseline is None or endpoint is None:
        return None, warnings + [f"incomplete_statistics:{statistic_id}"]

    delta = float(endpoint) - float(baseline)
    if delta < 0:
        warnings.append(f"negative_delta:{statistic_id}")
        return None, warnings
    return delta, warnings


def _resolve_ranges(preset: str, week_mode: str, custom_week_start: int, payload: dict[str, Any], tzinfo) -> tuple[dict[str, str] | None, dict[str, str] | None, list[str]]:
    warnings: list[str] = []
    now = datetime.now().astimezone(tzinfo)

    if preset == "today_vs_yesterday":
        ref_start = _start_of_day(now)
        ref_end = now
        elapsed = ref_end - ref_start
        cmp_start = _shift_days(ref_start, -1)
        cmp_end = cmp_start + elapsed
    elif preset == "this_week_vs_last_week":
        active_start = custom_week_start if week_mode == "custom" else 1
        js_day = (now.weekday() + 1) % 7
        diff = (js_day - active_start + 7) % 7
        ref_start = _start_of_day(_shift_days(now, -diff))
        ref_end = now
        elapsed = ref_end - ref_start
        cmp_start = _shift_days(ref_start, -7)
        cmp_end = cmp_start + elapsed
    elif preset == "this_weekend_vs_last_weekend":
        js_day = (now.weekday() + 1) % 7
        if js_day in (6, 0):
            diff = (js_day - 6 + 7) % 7
            ref_start = _start_of_day(_shift_days(now, -diff))
            ref_end = now
            elapsed = ref_end - ref_start
            cmp_start = _shift_days(ref_start, -7)
            cmp_end = cmp_start + elapsed
        else:
            diff = (js_day - 6 + 7) % 7
            last_saturday = _start_of_day(_shift_days(now, -diff))
            ref_start = last_saturday
            ref_end = _end_of_day(_shift_days(last_saturday, 1))
            cmp_start = _shift_days(ref_start, -7)
            cmp_end = _end_of_day(_shift_days(cmp_start, 1))
    elif preset == "custom_periods":
        ref_raw = payload.get("reference_range") if isinstance(payload.get("reference_range"), dict) else {}
        cmp_raw = payload.get("compare_range") if isinstance(payload.get("compare_range"), dict) else {}
        ref_start = _parse_dt(ref_raw.get("start"), tzinfo)
        ref_end = _parse_dt(ref_raw.get("end"), tzinfo)
        cmp_start = _parse_dt(cmp_raw.get("start"), tzinfo)
        cmp_end = _parse_dt(cmp_raw.get("end"), tzinfo)
        if not all([ref_start, ref_end, cmp_start, cmp_end]):
            warnings.append("custom_ranges_invalid_or_missing")
            duration = timedelta(days=7)
            ref_end = now
            ref_start = ref_end - duration
            cmp_end = ref_start
            cmp_start = cmp_end - duration
    else:
        warnings.append(f"unsupported_preset:{preset}")
        return None, None, warnings

    if ref_end < ref_start:
        ref_start, ref_end = ref_end, ref_start
        warnings.append("reference_range_swapped")
    if cmp_end < cmp_start:
        cmp_start, cmp_end = cmp_end, cmp_start
        warnings.append("compare_range_swapped")

    return (
        {"start": ref_start.isoformat(), "end": ref_end.isoformat()},
        {"start": cmp_start.isoformat(), "end": cmp_end.isoformat()},
        warnings,
    )


async def _sensor_compare_row(hass, pricing: dict[str, Any] | None, sensor_ref: str | dict[str, Any], ref_start: datetime, ref_end: datetime, cmp_start: datetime, cmp_end: datetime) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    snapshot = build_sensor_cost_snapshot(hass, pricing, sensor_ref)
    helper_total = None
    helpers = snapshot.get("helpers")
    if isinstance(helpers, dict):
        helper_total = helpers.get("total")

    ref_kwh, ref_warnings = await _history_energy_kwh(hass, helper_total, ref_start, ref_end)
    cmp_kwh, cmp_warnings = await _history_energy_kwh(hass, helper_total, cmp_start, cmp_end)
    warnings.extend(snapshot.get("warnings") or [])
    warnings.extend(ref_warnings)
    warnings.extend(cmp_warnings)

    reference_period, ref_cost_warnings = _row_from_kwh(ref_start, ref_end, ref_kwh, pricing, include_subscription=False)
    compare_period, cmp_cost_warnings = _row_from_kwh(cmp_start, cmp_end, cmp_kwh, pricing, include_subscription=False)
    warnings.extend(ref_cost_warnings)
    warnings.extend(cmp_cost_warnings)

    delta = _summary_delta(reference_period, compare_period)
    return (
        {
            "entity_id": snapshot.get("entity_id"),
            "name": snapshot.get("name") or snapshot.get("entity_id"),
            "reference_period": reference_period,
            "compare_period": compare_period,
            "delta": {
                "kwh": delta.get("delta_kwh"),
                "cost_ht": delta.get("delta_cost_ht"),
                "cost_ttc": delta.get("delta_cost_ttc"),
                "total_ht": delta.get("delta_total_ht"),
                "total_ttc": delta.get("delta_total_ttc"),
                "pct_total_ht": delta.get("pct_total_ht"),
                "pct_total_ttc": delta.get("pct_total_ttc"),
            },
        },
        sorted(set(warnings)),
    )


def _sum_sensor_rows(rows: list[dict[str, Any]], key: str, start: datetime, end: datetime, pricing: dict[str, Any] | None, *, include_subscription: bool) -> tuple[dict[str, float | None], list[str]]:
    values = [row.get(key, {}).get("kwh") for row in rows if isinstance(row, dict)]
    kwh_sum = sum(float(v) for v in values if isinstance(v, (int, float))) if any(isinstance(v, (int, float)) for v in values) else None
    return _row_from_kwh(start, end, kwh_sum, pricing, include_subscription=include_subscription)


class CostsCompareView(HomeAssistantView):
    url = f"{API_PREFIX}/costs/compare"
    name = "hse:unified:costs_compare"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]
        payload = await request.json() if request.can_read_body else {}

        preset = payload.get("preset") or "today_vs_yesterday"
        tax_mode = payload.get("tax_mode") or "ttc"
        week_mode = payload.get("week_mode") or "classic"
        custom_week_start = payload.get("custom_week_start")
        try:
            custom_week_start = int(custom_week_start if custom_week_start is not None else 5)
        except (TypeError, ValueError):
            custom_week_start = 5
        if custom_week_start < 0 or custom_week_start > 6:
            custom_week_start = 5
        if tax_mode not in ("ht", "ttc"):
            tax_mode = "ttc"
        if week_mode not in ("classic", "custom"):
            week_mode = "classic"
        if preset not in _SUPPORTED_PRESETS:
            preset = "today_vs_yesterday"

        domain_data = hass.data.get(DOMAIN, {})
        catalogue = domain_data.get("catalogue") or {"items": {}, "settings": {}}
        settings = catalogue.get("settings") or {}
        pricing = settings.get("pricing") if isinstance(settings, dict) else None
        defaults = settings.get("pricing_defaults") if isinstance(settings, dict) else None

        warnings: list[str] = []
        cost_ids: list[str] = []
        if isinstance(pricing, dict):
            raw_ids = pricing.get("cost_entity_ids")
            if isinstance(raw_ids, list):
                cost_ids = [x for x in raw_ids if isinstance(x, str) and x]

        if not pricing:
            warnings.append("pricing_not_configured")
        if not cost_ids:
            warnings.append("pricing_has_no_cost_entity_ids")

        tzinfo = datetime.now().astimezone().tzinfo
        resolved_reference_range, resolved_compare_range, range_warnings = _resolve_ranges(preset, week_mode, custom_week_start, payload, tzinfo)
        warnings.extend(range_warnings)

        if not resolved_reference_range or not resolved_compare_range:
            return self.json(
                {
                    "ok": True,
                    "supported": False,
                    "meta": {
                        "preset_used": preset,
                        "tax_mode": tax_mode,
                        "week_mode": week_mode,
                        "custom_week_start": custom_week_start,
                        "resolved_reference_range": resolved_reference_range,
                        "resolved_compare_range": resolved_compare_range,
                        "generated_at": datetime.now().astimezone().isoformat(),
                        "compare_source": "recorder_statistics_total_helper",
                    },
                    "reference_period": {"reference": _empty_period_row(), "internal": _empty_period_row(), "delta": _empty_period_row()},
                    "compare_period": {"reference": _empty_period_row(), "internal": _empty_period_row(), "delta": _empty_period_row()},
                    "summary": {"reference": _summary_delta(_empty_period_row(), _empty_period_row()), "internal": _summary_delta(_empty_period_row(), _empty_period_row()), "delta": _summary_delta(_empty_period_row(), _empty_period_row())},
                    "per_sensor": [],
                    "pricing": pricing,
                    "defaults": defaults,
                    "warnings": sorted(set(warnings)),
                }
            )

        ref_start = _parse_dt(resolved_reference_range.get("start"), tzinfo)
        ref_end = _parse_dt(resolved_reference_range.get("end"), tzinfo)
        cmp_start = _parse_dt(resolved_compare_range.get("start"), tzinfo)
        cmp_end = _parse_dt(resolved_compare_range.get("end"), tzinfo)
        if not all([ref_start, ref_end, cmp_start, cmp_end]):
            warnings.append("resolved_ranges_unparseable")
            return self.json(
                {
                    "ok": True,
                    "supported": False,
                    "meta": {
                        "preset_used": preset,
                        "tax_mode": tax_mode,
                        "week_mode": week_mode,
                        "custom_week_start": custom_week_start,
                        "resolved_reference_range": resolved_reference_range,
                        "resolved_compare_range": resolved_compare_range,
                        "generated_at": datetime.now().astimezone().isoformat(),
                        "compare_source": "recorder_statistics_total_helper",
                    },
                    "reference_period": {"reference": _empty_period_row(), "internal": _empty_period_row(), "delta": _empty_period_row()},
                    "compare_period": {"reference": _empty_period_row(), "internal": _empty_period_row(), "delta": _empty_period_row()},
                    "summary": {"reference": _summary_delta(_empty_period_row(), _empty_period_row()), "internal": _summary_delta(_empty_period_row(), _empty_period_row()), "delta": _summary_delta(_empty_period_row(), _empty_period_row())},
                    "per_sensor": [],
                    "pricing": pricing,
                    "defaults": defaults,
                    "warnings": sorted(set(warnings)),
                }
            )

        sensor_rows: list[dict[str, Any]] = []
        for eid in cost_ids:
            sensor_ref = _catalogue_item_by_source_entity_id(catalogue, eid) or eid
            row, row_warnings = await _sensor_compare_row(hass, pricing, sensor_ref, ref_start, ref_end, cmp_start, cmp_end)
            sensor_rows.append(row)
            warnings.extend([f"{eid}:{w}" for w in row_warnings])

        internal_current, internal_cur_warnings = _sum_sensor_rows(sensor_rows, "reference_period", ref_start, ref_end, pricing, include_subscription=True)
        internal_previous, internal_prev_warnings = _sum_sensor_rows(sensor_rows, "compare_period", cmp_start, cmp_end, pricing, include_subscription=True)
        warnings.extend([f"internal:{w}" for w in internal_cur_warnings + internal_prev_warnings])

        ref_eid = _current_reference_entity_id(catalogue)
        reference_current = _empty_period_row()
        reference_previous = _empty_period_row()
        if ref_eid:
            ref_sensor_ref = _current_reference_item(catalogue) or ref_eid
            ref_row, ref_warnings = await _sensor_compare_row(hass, pricing, ref_sensor_ref, ref_start, ref_end, cmp_start, cmp_end)
            reference_current, ref_cur_cost_warn = _row_from_kwh(ref_start, ref_end, (ref_row.get("reference_period") or {}).get("kwh"), pricing, include_subscription=True)
            reference_previous, ref_prev_cost_warn = _row_from_kwh(cmp_start, cmp_end, (ref_row.get("compare_period") or {}).get("kwh"), pricing, include_subscription=True)
            warnings.extend([f"reference:{ref_eid}:{w}" for w in ref_warnings + ref_cur_cost_warn + ref_prev_cost_warn])
        else:
            warnings.append("no_reference_configured")

        delta_current = _delta_row(reference_current, internal_current)
        delta_previous = _delta_row(reference_previous, internal_previous)

        sort_key = "total_ht" if tax_mode == "ht" else "total_ttc"
        sensor_rows.sort(key=lambda row: float((((row.get("delta") or {}).get(sort_key)) or 0.0)), reverse=True)

        return self.json(
            {
                "ok": True,
                "supported": True,
                "meta": {
                    "preset_used": preset,
                    "tax_mode": tax_mode,
                    "week_mode": week_mode,
                    "custom_week_start": custom_week_start,
                    "resolved_reference_range": resolved_reference_range,
                    "resolved_compare_range": resolved_compare_range,
                    "generated_at": datetime.now().astimezone().isoformat(),
                    "compare_source": "recorder_statistics_total_helper",
                },
                "reference_period": {
                    "reference": reference_current,
                    "internal": internal_current,
                    "delta": delta_current,
                },
                "compare_period": {
                    "reference": reference_previous,
                    "internal": internal_previous,
                    "delta": delta_previous,
                },
                "summary": {
                    "reference": _summary_delta(reference_current, reference_previous),
                    "internal": _summary_delta(internal_current, internal_previous),
                    "delta": _summary_delta(delta_current, delta_previous),
                },
                "per_sensor": sensor_rows,
                "pricing": pricing,
                "defaults": defaults,
                "warnings": sorted(set(warnings)),
            }
        )
