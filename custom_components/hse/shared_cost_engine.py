"""HSE_DOC: custom_components/hse/docs/shared_cost_engine.md
HSE_MAINTENANCE: If you change snapshot shape or cost computation logic, update the doc above.

Shared backend helpers to derive energy and cost snapshots from pricing + helpers.

This module is intentionally UI-agnostic. It reads the existing pricing contract,
prefer explicit helper mappings stored in the catalogue, and exposes
sensor-level/aggregate snapshots that can later feed overview.
"""

from __future__ import annotations

import re
from typing import Any


_SUFFIX_STRIP = (
    "_consommation_actuelle",
    "_puissance",
    "_power",
    "_w",
    "_watts",
)

_PERIODS = ("hour", "day", "week", "month", "year")
_HELPER_SUFFIX_BY_PERIOD = {
    "day": "kwh_day",
    "week": "kwh_week",
    "month": "kwh_month",
    "year": "kwh_year",
}


def _num(value: Any) -> float | None:
    try:
        out = float(value)
        return out if out == out else None
    except (TypeError, ValueError):
        return None


def _power_w_from_state(st) -> float | None:
    if not st:
        return None
    value = _num(st.state)
    if value is None:
        return None
    unit = (st.attributes or {}).get("unit_of_measurement") or ""
    if unit in ("kW", "kw"):
        return value * 1000.0
    return value


def _energy_kwh_from_state(st) -> float | None:
    if not st:
        return None
    value = _num(st.state)
    if value is None:
        return None
    unit = ((st.attributes or {}).get("unit_of_measurement") or "").lower()
    if unit == "wh":
        return value / 1000.0
    return value


def derive_base_slug(power_entity_id: str) -> str:
    if not isinstance(power_entity_id, str) or "." not in power_entity_id:
        raise ValueError("invalid_entity_id")

    domain, obj = power_entity_id.split(".", 1)
    if domain != "sensor" or not obj:
        raise ValueError("invalid_entity_id")

    base = obj
    for suffix in _SUFFIX_STRIP:
        if base.endswith(suffix):
            base = base[: -len(suffix)]
            break

    base = re.sub(r"_+$", "", base)
    if not base:
        raise ValueError("cannot_derive_base")
    return base


def expected_energy_helpers(power_entity_id: str) -> dict[str, str]:
    base = derive_base_slug(power_entity_id)
    return {
        "base": base,
        "total": f"sensor.{base}_kwh_total",
        "day": f"sensor.{base}_kwh_day",
        "week": f"sensor.{base}_kwh_week",
        "month": f"sensor.{base}_kwh_month",
        "year": f"sensor.{base}_kwh_year",
    }


def _extract_power_entity_id(sensor_ref: str | dict[str, Any]) -> str:
    if isinstance(sensor_ref, str) and sensor_ref:
        return sensor_ref
    if isinstance(sensor_ref, dict):
        source = sensor_ref.get("source") or {}
        entity_id = source.get("entity_id") if isinstance(source, dict) else None
        if isinstance(entity_id, str) and entity_id:
            return entity_id
        entity_id = sensor_ref.get("entity_id")
        if isinstance(entity_id, str) and entity_id:
            return entity_id
    raise ValueError("invalid_sensor_ref")


def _extract_catalogue_energy_helpers(sensor_ref: str | dict[str, Any]) -> dict[str, str | None] | None:
    if not isinstance(sensor_ref, dict):
        return None

    derived = sensor_ref.get("derived")
    if not isinstance(derived, dict):
        return None
    helpers = derived.get("helpers")
    if not isinstance(helpers, dict):
        return None
    energy = helpers.get("energy")
    if not isinstance(energy, dict):
        return None

    out = {
        "total": energy.get("total") if isinstance(energy.get("total"), str) and energy.get("total") else None,
        "day": energy.get("day") if isinstance(energy.get("day"), str) and energy.get("day") else None,
        "week": energy.get("week") if isinstance(energy.get("week"), str) and energy.get("week") else None,
        "month": energy.get("month") if isinstance(energy.get("month"), str) and energy.get("month") else None,
        "year": energy.get("year") if isinstance(energy.get("year"), str) and energy.get("year") else None,
    }
    if not any(out.values()):
        return None
    return out


def _extract_display_name(sensor_ref: str | dict[str, Any], power_st, power_entity_id: str) -> str:
    if power_st is not None:
        friendly_name = (power_st.attributes or {}).get("friendly_name")
        if isinstance(friendly_name, str) and friendly_name:
            return friendly_name

    if isinstance(sensor_ref, dict):
        source = sensor_ref.get("source") or {}
        name = source.get("name") if isinstance(source, dict) else None
        if isinstance(name, str) and name:
            return name

    return power_entity_id


def _energy_price_pair(pricing: dict[str, Any], period: str) -> tuple[float | None, float | None, str | None]:
    contract_type = pricing.get("contract_type") if isinstance(pricing, dict) else None
    if contract_type == "fixed":
        pair = pricing.get("fixed_energy_per_kwh") if isinstance(pricing, dict) else None
        if not isinstance(pair, dict):
            return None, None, "missing_fixed_energy_price"
        return _num(pair.get("ht")), _num(pair.get("ttc")), None

    if contract_type == "hphc":
        return None, None, f"unsupported_period_for_hphc:{period}"

    return None, None, "invalid_contract_type"


def _compute_cost_pair(pricing: dict[str, Any], period: str, kwh: float | None) -> tuple[float | None, float | None, str | None]:
    if kwh is None:
        return None, None, "missing_energy"

    ht_per_kwh, ttc_per_kwh, reason = _energy_price_pair(pricing, period)
    if reason:
        return None, None, reason
    if ht_per_kwh is None or ttc_per_kwh is None:
        return None, None, "missing_rate"
    return kwh * ht_per_kwh, kwh * ttc_per_kwh, None


def build_sensor_cost_snapshot(hass, pricing: dict[str, Any] | None, sensor_ref: str | dict[str, Any]) -> dict[str, Any]:
    warnings: list[str] = []

    try:
        power_entity_id = _extract_power_entity_id(sensor_ref)
    except ValueError as exc:
        return {
            "entity_id": None,
            "name": None,
            "base": None,
            "helpers": None,
            "energy_kwh": {p: None for p in _PERIODS},
            "cost_ht": {p: None for p in _PERIODS},
            "cost_ttc": {p: None for p in _PERIODS},
            "warnings": [f"invalid_sensor_ref:{exc}"],
        }

    power_st = hass.states.get(power_entity_id)
    power_w = _power_w_from_state(power_st)

    helpers = _extract_catalogue_energy_helpers(sensor_ref)
    helper_resolution = "catalogue"
    base = None

    if helpers is None:
        try:
            legacy_helpers = expected_energy_helpers(power_entity_id)
        except ValueError as exc:
            return {
                "entity_id": power_entity_id,
                "name": _extract_display_name(sensor_ref, power_st, power_entity_id),
                "base": None,
                "helpers": None,
                "energy_kwh": {p: None for p in _PERIODS},
                "cost_ht": {p: None for p in _PERIODS},
                "cost_ttc": {p: None for p in _PERIODS},
                "warnings": [f"derive_base_failed:{exc}"],
            }
        helpers = {
            "total": legacy_helpers.get("total"),
            "day": legacy_helpers.get("day"),
            "week": legacy_helpers.get("week"),
            "month": legacy_helpers.get("month"),
            "year": legacy_helpers.get("year"),
        }
        base = legacy_helpers.get("base")
        helper_resolution = "legacy_derived"
        warnings.append("helpers_resolution:legacy_derived")

    energy_kwh: dict[str, float | None] = {p: None for p in _PERIODS}
    if power_w is not None:
        energy_kwh["hour"] = power_w / 1000.0
    else:
        warnings.append("missing_live_power")

    for period, helper_suffix in _HELPER_SUFFIX_BY_PERIOD.items():
        helper_entity_id = helpers.get(period) if isinstance(helpers, dict) else None
        if not helper_entity_id:
            warnings.append(f"missing_helper_mapping:{period}")
            continue
        helper_st = hass.states.get(helper_entity_id)
        energy_kwh[period] = _energy_kwh_from_state(helper_st)
        if energy_kwh[period] is None:
            warnings.append(f"missing_helper:{helper_entity_id}")

    cost_ht: dict[str, float | None] = {}
    cost_ttc: dict[str, float | None] = {}
    for period in _PERIODS:
        cur_ht, cur_ttc, reason = _compute_cost_pair(pricing or {}, period, energy_kwh.get(period))
        cost_ht[period] = cur_ht
        cost_ttc[period] = cur_ttc
        if reason and reason not in ("missing_energy",):
            warnings.append(f"{period}:{reason}")

    return {
        "entity_id": power_entity_id,
        "name": _extract_display_name(sensor_ref, power_st, power_entity_id),
        "base": base,
        "helpers": helpers,
        "helpers_resolution": helper_resolution,
        "power_w": power_w,
        "energy_kwh": energy_kwh,
        "cost_ht": cost_ht,
        "cost_ttc": cost_ttc,
        "warnings": sorted(set(warnings)),
    }


def aggregate_sensor_cost_snapshots(snapshots: list[dict[str, Any]]) -> dict[str, dict[str, float | None]]:
    out: dict[str, dict[str, float | None]] = {}
    for period in _PERIODS:
        energy_values = [s.get("energy_kwh", {}).get(period) for s in snapshots if isinstance(s, dict)]
        ht_values = [s.get("cost_ht", {}).get(period) for s in snapshots if isinstance(s, dict)]
        ttc_values = [s.get("cost_ttc", {}).get(period) for s in snapshots if isinstance(s, dict)]

        energy = [float(v) for v in energy_values if isinstance(v, (int, float))]
        ht = [float(v) for v in ht_values if isinstance(v, (int, float))]
        ttc = [float(v) for v in ttc_values if isinstance(v, (int, float))]

        out[period] = {
            "energy_kwh": sum(energy) if energy else None,
            "conso_ht": sum(ht) if ht else None,
            "conso_ttc": sum(ttc) if ttc else None,
        }
    return out
