"""HSE_DOC: custom_components/hse/docs/unified_api.md

Dashboard endpoint used by the frontend Accueil (overview).

Design goals:
- One endpoint for the overview to avoid duplicating business logic in JS.
- Never hard-fail if some sensors/fields are missing; return nulls + warnings.
"""

from __future__ import annotations

from typing import Any

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...shared_cost_engine import aggregate_sensor_cost_snapshots, build_sensor_cost_snapshot


_PERIODS = ("hour", "day", "week", "month", "year")


def _num(x: Any) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _power_w_from_state(st) -> float | None:
    if not st:
        return None
    v = _num(st.state)
    if v is None:
        return None
    unit = (st.attributes or {}).get("unit_of_measurement") or ""
    if unit in ("kW", "kw"):
        return v * 1000.0
    return v


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
    for it in items.values():
        if not isinstance(it, dict):
            continue
        enr = it.get("enrichment") or {}
        if isinstance(enr, dict) and enr.get("is_reference_total") is True:
            return it
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


def _subscription_for_period(pricing: dict[str, Any] | None, period: str) -> tuple[float | None, float | None]:
    if not isinstance(pricing, dict):
        return None, None
    monthly = pricing.get("subscription_monthly")
    if not isinstance(monthly, dict):
        return None, None

    ht = _num(monthly.get("ht"))
    ttc = _num(monthly.get("ttc"))
    if ht is None or ttc is None:
        return None, None

    if period == "month":
        return ht, ttc
    if period == "year":
        return ht * 12.0, ttc * 12.0
    if period == "week":
        return (ht * 12.0) / 52.0, (ttc * 12.0) / 52.0
    return None, None


def _coerce_subscription_for_display(value: float | None, *, has_row_data: bool) -> float | None:
    if value is not None:
        return float(value)
    if has_row_data:
        return 0.0
    return None


def _mk_period_row(period: str, agg: dict[str, dict[str, float | None]], pricing: dict[str, Any] | None) -> dict:
    cur = agg.get(period) if isinstance(agg, dict) else {}
    cost_ht = cur.get("conso_ht") if isinstance(cur, dict) else None
    cost_ttc = cur.get("conso_ttc") if isinstance(cur, dict) else None
    kwh = cur.get("energy_kwh") if isinstance(cur, dict) else None

    has_row_data = any(v is not None for v in (kwh, cost_ht, cost_ttc))
    subscription_ht, subscription_ttc = _subscription_for_period(pricing, period)
    subscription_ht = _coerce_subscription_for_display(subscription_ht, has_row_data=has_row_data)
    subscription_ttc = _coerce_subscription_for_display(subscription_ttc, has_row_data=has_row_data)

    total_ht = None
    if cost_ht is not None:
        total_ht = float(cost_ht) + float(subscription_ht or 0.0)

    total_ttc = None
    if cost_ttc is not None:
        total_ttc = float(cost_ttc) + float(subscription_ttc or 0.0)

    return {
        "period": period,
        "kwh": kwh,
        "cost_ht": cost_ht,
        "cost_ttc": cost_ttc,
        "subscription_ht": subscription_ht,
        "subscription_ttc": subscription_ttc,
        "total_ht": total_ht,
        "total_ttc": total_ttc,
    }


def _mk_period_table(agg: dict[str, dict[str, float | None]], pricing: dict[str, Any] | None) -> list[dict]:
    return [_mk_period_row(period, agg, pricing) for period in _PERIODS]


def _sub_opt(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return float(a) - float(b)


def _build_delta_period_table(
    reference_agg: dict[str, dict[str, float | None]],
    internal_agg: dict[str, dict[str, float | None]],
    pricing: dict[str, Any] | None,
) -> list[dict]:
    rows: list[dict] = []
    for period in _PERIODS:
        ref_cur = reference_agg.get(period) if isinstance(reference_agg, dict) else {}
        int_cur = internal_agg.get(period) if isinstance(internal_agg, dict) else {}

        cost_ht = _sub_opt(
            ref_cur.get("conso_ht") if isinstance(ref_cur, dict) else None,
            int_cur.get("conso_ht") if isinstance(int_cur, dict) else None,
        )
        cost_ttc = _sub_opt(
            ref_cur.get("conso_ttc") if isinstance(ref_cur, dict) else None,
            int_cur.get("conso_ttc") if isinstance(int_cur, dict) else None,
        )
        kwh = _sub_opt(
            ref_cur.get("energy_kwh") if isinstance(ref_cur, dict) else None,
            int_cur.get("energy_kwh") if isinstance(int_cur, dict) else None,
        )

        ref_sub_ht, ref_sub_ttc = _subscription_for_period(pricing, period)
        int_sub_ht, int_sub_ttc = _subscription_for_period(pricing, period)
        delta_sub_ht = _sub_opt(ref_sub_ht, int_sub_ht)
        delta_sub_ttc = _sub_opt(ref_sub_ttc, int_sub_ttc)

        has_row_data = any(v is not None for v in (kwh, cost_ht, cost_ttc))
        delta_sub_ht = _coerce_subscription_for_display(delta_sub_ht, has_row_data=has_row_data)
        delta_sub_ttc = _coerce_subscription_for_display(delta_sub_ttc, has_row_data=has_row_data)

        total_ht = None if cost_ht is None else float(cost_ht) + float(delta_sub_ht or 0.0)
        total_ttc = None if cost_ttc is None else float(cost_ttc) + float(delta_sub_ttc or 0.0)

        rows.append(
            {
                "period": period,
                "kwh": kwh,
                "cost_ht": cost_ht,
                "cost_ttc": cost_ttc,
                "subscription_ht": delta_sub_ht,
                "subscription_ttc": delta_sub_ttc,
                "total_ht": total_ht,
                "total_ttc": total_ttc,
            }
        )
    return rows


def _meta_sync_summary(domain_data: dict) -> dict:
    meta_store = domain_data.get("meta")
    if not isinstance(meta_store, dict):
        return {"ok": False, "pending": False, "stats": None, "last_run": None, "last_error": None, "pending_generated_at": None}

    sync = meta_store.get("sync") if isinstance(meta_store.get("sync"), dict) else {}
    pending = sync.get("pending_diff")

    stats = None
    if isinstance(pending, dict):
        stats = pending.get("stats")

    return {
        "ok": True,
        "pending": bool(isinstance(pending, dict) and pending.get("has_changes")),
        "stats": stats if isinstance(stats, dict) else None,
        "last_run": sync.get("last_run"),
        "last_error": sync.get("last_error"),
        "pending_generated_at": sync.get("pending_generated_at"),
    }


class DashboardOverviewView(HomeAssistantView):
    url = f"{API_PREFIX}/dashboard"
    name = "hse:unified:dashboard_overview"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]

        domain_data = hass.data.get(DOMAIN, {})

        catalogue = domain_data.get("catalogue")
        if not catalogue:
            catalogue = {"schema_version": 1, "generated_at": None, "items": {}, "settings": {}}

        settings = catalogue.get("settings") or {}
        pricing = settings.get("pricing") if isinstance(settings, dict) else None
        defaults = settings.get("pricing_defaults") if isinstance(settings, dict) else None
        display_mode = pricing.get("display_mode") if isinstance(pricing, dict) else "ttc"
        if display_mode not in ("ht", "ttc"):
            display_mode = "ttc"

        cost_ids: list[str] = []
        if isinstance(pricing, dict):
            cids = pricing.get("cost_entity_ids")
            if isinstance(cids, list):
                cost_ids = [x for x in cids if isinstance(x, str) and x]

        warnings: list[str] = []
        if not pricing:
            warnings.append("pricing_not_configured")
        elif not cost_ids:
            warnings.append("pricing_has_no_cost_entity_ids")

        selected: list[dict] = []
        for eid in cost_ids:
            st = hass.states.get(eid)
            w = _power_w_from_state(st)
            name = None
            if st:
                name = (st.attributes or {}).get("friendly_name")
            selected.append(
                {
                    "entity_id": eid,
                    "name": name or eid,
                    "power_w": w,
                    "state": None if not st else st.state,
                    "unit": None if not st else (st.attributes or {}).get("unit_of_measurement"),
                    "last_updated": None if not st else (st.last_updated or st.last_changed),
                }
            )

        top_src = [r for r in selected if isinstance(r.get("power_w"), (int, float))]
        top_src.sort(key=lambda r: float(r["power_w"]), reverse=True)

        bucket_100_500 = [r for r in top_src if 100.0 <= float(r["power_w"]) <= 500.0][:8]
        bucket_gt_500 = [r for r in top_src if float(r["power_w"]) > 500.0][:8]

        total_w = sum(float(r.get("power_w") or 0.0) for r in selected)

        ref_item = _current_reference_item(catalogue)
        ref_eid = _current_reference_entity_id(catalogue)
        reference = None
        delta = None

        if ref_eid:
            ref_st = hass.states.get(ref_eid)
            ref_w = _power_w_from_state(ref_st)
            reference = {
                "entity_id": ref_eid,
                "name": None if not ref_st else (ref_st.attributes or {}).get("friendly_name"),
                "power_w": ref_w,
                "state": None if not ref_st else ref_st.state,
                "unit": None if not ref_st else (ref_st.attributes or {}).get("unit_of_measurement"),
                "last_updated": None if not ref_st else (ref_st.last_updated or ref_st.last_changed),
            }
            if ref_w is not None:
                delta = {"power_w": float(ref_w) - float(total_w)}
        else:
            warnings.append("no_reference_configured")

        sensor_snapshots = [
            build_sensor_cost_snapshot(hass, pricing, _catalogue_item_by_source_entity_id(catalogue, eid) or eid)
            for eid in cost_ids
        ]
        aggregate = aggregate_sensor_cost_snapshots(sensor_snapshots)

        for snap in sensor_snapshots:
            for warning in snap.get("warnings") or []:
                warnings.append(f"{snap.get('entity_id')}:{warning}")

        reference_snapshot = None
        reference_aggregate: dict[str, dict[str, float | None]] = {}
        if ref_eid:
            reference_snapshot = build_sensor_cost_snapshot(hass, pricing, ref_item or ref_eid)
            reference_aggregate = aggregate_sensor_cost_snapshots([reference_snapshot])
            for warning in reference_snapshot.get("warnings") or []:
                warnings.append(f"reference:{ref_eid}:{warning}")

        totals = {}
        for period in ("week", "month", "year"):
            cur = aggregate.get(period) or {}
            subscription_ht, subscription_ttc = _subscription_for_period(pricing, period)
            conso_ht = cur.get("conso_ht")
            conso_ttc = cur.get("conso_ttc")
            totals[period] = {
                "energy_kwh": cur.get("energy_kwh"),
                "conso_ht": conso_ht,
                "conso_ttc": conso_ttc,
                "subscription_ht": subscription_ht,
                "subscription_ttc": subscription_ttc,
                "total_ht": None if conso_ht is None else float(conso_ht) + float(subscription_ht or 0.0),
                "total_ttc": None if conso_ttc is None else float(conso_ttc) + float(subscription_ttc or 0.0),
            }

        cumulative_table = _mk_period_table(aggregate, pricing)
        reference_table = _mk_period_table(reference_aggregate, pricing) if reference_snapshot else []
        delta_table = _build_delta_period_table(reference_aggregate, aggregate, pricing) if reference_snapshot else []

        per_sensor_costs = []
        for snap in sensor_snapshots:
            per_sensor_costs.append(
                {
                    "entity_id": snap.get("entity_id"),
                    "name": snap.get("name") or snap.get("entity_id"),
                    "cost_ht": snap.get("cost_ht") if isinstance(snap.get("cost_ht"), dict) else {},
                    "cost_ttc": snap.get("cost_ttc") if isinstance(snap.get("cost_ttc"), dict) else {},
                }
            )

        if selected and all((r.get("power_w") is None) for r in selected):
            warnings.append("selected_sensors_have_no_numeric_state")

        meta_sync = _meta_sync_summary(domain_data)

        return self.json(
            {
                "ok": True,
                "generated_at": catalogue.get("generated_at"),
                "pricing": pricing,
                "defaults": defaults,
                "selected": selected,
                "top_live": {"bucket_100_500": bucket_100_500, "bucket_gt_500": bucket_gt_500},
                "computed": {"total_power_w": total_w},
                "reference": reference,
                "delta": delta,
                "totals": totals,
                "cumulative_table": cumulative_table,
                "reference_table": reference_table,
                "delta_table": delta_table,
                "per_sensor_costs": per_sensor_costs,
                "meta_sync": meta_sync,
                "warnings": sorted(set(warnings)),
            }
        )
