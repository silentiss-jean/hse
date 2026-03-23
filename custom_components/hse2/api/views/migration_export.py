from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import yaml
from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...scan_engine import detect_kind
from .enrich_preview import derive_base_slug


_KWH_SUFFIXES = ("_kwh_total", "_kwh_day", "_kwh_week", "_kwh_month", "_kwh_year")


def _num(x: Any) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def _derive_base_from_energy_entity_id(entity_id: str) -> str | None:
    if not isinstance(entity_id, str) or "." not in entity_id:
        return None
    domain, obj = entity_id.split(".", 1)
    if domain != "sensor" or not obj:
        return None

    base = obj
    for suf in _KWH_SUFFIXES:
        if base.endswith(suf):
            base = base[: -len(suf)]
            break

    base = base.rstrip("_")
    return base or None


def _pricing_from_catalogue(cat: dict) -> dict | None:
    settings = (cat or {}).get("settings")
    if not isinstance(settings, dict):
        return None
    pr = settings.get("pricing")
    return pr if isinstance(pr, dict) else None


def _selected_entity_ids(cat: dict) -> list[str]:
    pricing = _pricing_from_catalogue(cat) or {}
    cids = pricing.get("cost_entity_ids")
    if not isinstance(cids, list):
        return []
    out: list[str] = []
    for x in cids:
        if isinstance(x, str) and x and x not in out:
            out.append(x)
    return out


def _safe_yaml(obj: Any) -> str:
    return yaml.safe_dump(obj, sort_keys=False, allow_unicode=True)


def _mk_integration_sensor_yaml(power_entity_id: str, energy_total_entity_id: str) -> dict:
    # NOTE: HA integration sensor generates energy from power. We use unit_prefix k to produce kWh.
    # Entity_id itself is not set in YAML; HA will create sensor.<slugified name>.
    # We align by choosing name matching our target entity_id suffix.
    name = energy_total_entity_id.split(".", 1)[1]
    return {
        "platform": "integration",
        "source": power_entity_id,
        "name": name,
        "unit_prefix": "k",
        "round": 3,
        "method": "left",
    }


def _mk_utility_meter_yaml(energy_total_entity_id: str, base: str) -> dict:
    # Utility meter names are keys; we follow HSE naming scheme.
    return {
        f"{base}_kwh_day": {"source": energy_total_entity_id, "cycle": "daily"},
        f"{base}_kwh_week": {"source": energy_total_entity_id, "cycle": "weekly"},
        f"{base}_kwh_month": {"source": energy_total_entity_id, "cycle": "monthly"},
        f"{base}_kwh_year": {"source": energy_total_entity_id, "cycle": "yearly"},
    }


def _mk_cost_template_yaml(*, base: str, pricing: dict) -> dict | None:
    contract_type = pricing.get("contract_type")
    if contract_type != "fixed":
        return None

    fixed = pricing.get("fixed_energy_per_kwh")
    if not isinstance(fixed, dict):
        return None

    ttc = _num(fixed.get("ttc"))
    ht = _num(fixed.get("ht"))

    if ttc is None or ht is None:
        return None

    e_day = f"sensor.{base}_kwh_day"
    e_week = f"sensor.{base}_kwh_week"
    e_month = f"sensor.{base}_kwh_month"
    e_year = f"sensor.{base}_kwh_year"

    def _tpl(eid: str, price: float) -> str:
        return f"{{{{ (states('{eid}')|float(0) * {price}) | round(2) }}}}"

    sensors = [
        {
            "name": f"hse_cost_{base}_day_ttc",
            "unit_of_measurement": "€",
            "state": _tpl(e_day, float(ttc)),
        },
        {
            "name": f"hse_cost_{base}_week_ttc",
            "unit_of_measurement": "€",
            "state": _tpl(e_week, float(ttc)),
        },
        {
            "name": f"hse_cost_{base}_month_ttc",
            "unit_of_measurement": "€",
            "state": _tpl(e_month, float(ttc)),
        },
        {
            "name": f"hse_cost_{base}_year_ttc",
            "unit_of_measurement": "€",
            "state": _tpl(e_year, float(ttc)),
        },
        {
            "name": f"hse_cost_{base}_day_ht",
            "unit_of_measurement": "€",
            "state": _tpl(e_day, float(ht)),
        },
    ]

    return {"template": [{"sensor": sensors}]}


class MigrationExportView(HomeAssistantView):
    """Generate YAML exports for HA helpers/templates for selected sensors."""

    url = f"{API_PREFIX}/migration/export"
    name = "hse:unified:migration_export"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]

        cat = hass.data.get(DOMAIN, {}).get("catalogue")
        if not cat:
            cat = {"schema_version": 1, "generated_at": None, "items": {}, "settings": {}}

        pricing = _pricing_from_catalogue(cat) or {}
        selected = _selected_entity_ids(cat)

        body = await request.json() if request.can_read_body else {}
        mode = (body or {}).get("mode") or "selection"

        if mode == "selection":
            entity_ids = selected
        else:
            raw = (body or {}).get("entity_ids")
            entity_ids = [x for x in raw if isinstance(x, str) and x] if isinstance(raw, list) else selected

        warnings: list[str] = []

        bases: dict[str, dict[str, Any]] = {}
        for eid in entity_ids:
            st = hass.states.get(eid)
            attrs = st.attributes if st else {}
            unit = (attrs or {}).get("unit_of_measurement")
            device_class = (attrs or {}).get("device_class")
            kind = detect_kind(device_class, unit)

            base = None
            power_eid = None
            energy_total_eid = None

            if kind == "power":
                try:
                    base = derive_base_slug(eid)
                except Exception:
                    base = None
                if base:
                    power_eid = eid
                    energy_total_eid = f"sensor.{base}_kwh_total"
            elif kind == "energy":
                base = _derive_base_from_energy_entity_id(eid)
                if base:
                    energy_total_eid = f"sensor.{base}_kwh_total"
            else:
                warnings.append(f"skip_unknown_kind:{eid}")

            if not base:
                warnings.append(f"cannot_derive_base:{eid}")
                continue

            cur = bases.setdefault(base, {"base": base, "selected_entity_ids": []})
            cur["selected_entity_ids"].append(eid)

            if power_eid and not cur.get("power_entity_id"):
                cur["power_entity_id"] = power_eid

            if energy_total_eid:
                cur["energy_total_entity_id"] = energy_total_eid

        # Build exports
        integration_sensors = []
        utility_meter_block: dict[str, Any] = {}
        cost_template = _mk_cost_template_yaml(base="X", pricing=pricing)  # probe
        _ = cost_template

        cost_template_sensors = []

        for base, info in sorted(bases.items()):
            power_eid = info.get("power_entity_id")
            energy_total_eid = info.get("energy_total_entity_id") or f"sensor.{base}_kwh_total"

            # Option 2: integration from power -> kWh total
            if power_eid:
                integration_sensors.append(_mk_integration_sensor_yaml(power_eid, energy_total_eid))

            # Option 1: utility_meter day/week/month/year from energy_total
            utility_meter_block.update(_mk_utility_meter_yaml(energy_total_eid, base))

            # Option 3: cost sensors (fixed only, minimal starter)
            tpl = _mk_cost_template_yaml(base=base, pricing=pricing)
            if tpl and "template" in tpl:
                for block in tpl["template"]:
                    cost_template_sensors.append(block)
            else:
                if pricing.get("contract_type") != "fixed":
                    warnings.append(f"cost_export_not_supported_for_contract:{pricing.get('contract_type')}")

        exports: dict[str, str] = {}

        if integration_sensors:
            exports["option2_templates_riemann_yaml"] = _safe_yaml({"sensor": integration_sensors})
        else:
            exports["option2_templates_riemann_yaml"] = "# Rien à générer (aucun capteur power sélectionné)\n"

        if utility_meter_block:
            exports["option1_utility_meter_yaml"] = _safe_yaml({"utility_meter": utility_meter_block})
        else:
            exports["option1_utility_meter_yaml"] = "# Rien à générer\n"

        if cost_template_sensors:
            exports["option3_cost_sensors_yaml"] = _safe_yaml({"template": cost_template_sensors})
        else:
            exports["option3_cost_sensors_yaml"] = "# Option 3: non disponible (contrat non fixe ou données manquantes)\n"

        # Option 4 is intentionally not implemented yet
        exports["option4_auto_create"] = "# BETA: création automatique non implémentée\n"

        return self.json(
            {
                "ok": True,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "selection": {"count": len(entity_ids), "entity_ids": entity_ids},
                "bases": list(bases.values()),
                "pricing": {
                    "contract_type": pricing.get("contract_type"),
                    "display_mode": pricing.get("display_mode"),
                },
                "exports": exports,
                "warnings": warnings,
            }
        )
