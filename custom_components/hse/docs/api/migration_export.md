# API — `migration/export`

Target file:

- `custom_components/hse/api/views/migration_export.py`

---

## Endpoint

```
POST /api/hse/unified/migration/export
```

Requires auth: yes.

---

## Purpose

Generates ready-to-paste YAML snippets for creating HSE helper entities manually via `configuration.yaml`. Useful when the automatic `enrich/apply` config-flow approach is not available or desired.

---

## Request body

```json
{
  "mode": "selection",
  "entity_ids": ["sensor.xxx"]
}
```

- `mode`: `"selection"` (default) uses `catalogue.settings.pricing.cost_entity_ids`. Any other value uses the explicit `entity_ids` list.
- `entity_ids`: explicit list of power or energy sensor entity IDs to export for.

---

## Response

```json
{
  "ok": true,
  "generated_at": "<ISO>",
  "selection": { "count": 2, "entity_ids": [...] },
  "bases": [ { "base": "xxx", "power_entity_id": "sensor.xxx", "energy_total_entity_id": "sensor.xxx_kwh_total", "selected_entity_ids": [...] } ],
  "pricing": { "contract_type": "fixed", "display_mode": "ttc" },
  "exports": {
    "option1_utility_meter_yaml": "...",
    "option2_templates_riemann_yaml": "...",
    "option3_cost_sensors_yaml": "...",
    "option4_auto_create": "# BETA: création automatique non implémentée\n"
  },
  "warnings": []
}
```

---

## Export options

| Option | Key | Content | Requires |
|---|---|---|---|
| 1 | `option1_utility_meter_yaml` | `utility_meter:` block with day/week/month/year meters | An existing `*_kwh_total` energy sensor |
| 2 | `option2_templates_riemann_yaml` | `sensor:` block with `platform: integration` (Riemann sum) | A power sensor in W |
| 3 | `option3_cost_sensors_yaml` | `template:` block with cost sensors (day/week/month/year TTC + HT) | `contract_type: fixed` pricing configured |
| 4 | `option4_auto_create` | BETA placeholder — not implemented | — |

**Option 3** is only generated when `contract_type == "fixed"` and both `ht` and `ttc` rates are present in `fixed_energy_per_kwh`.

---

## Warnings

| Code | Meaning |
|---|---|
| `skip_unknown_kind:{entity_id}` | Entity is neither power nor energy kind |
| `cannot_derive_base:{entity_id}` | Base slug could not be derived |
| `cost_export_not_supported_for_contract:{type}` | Option 3 not available for non-fixed contracts |

---

## Maintenance notes

- Option 4 is intentionally left as a BETA placeholder. When implementing, add a new view rather than extending this one.
- `_mk_integration_sensor_yaml` and `_mk_utility_meter_yaml` are also imported and used by `enrich_apply.py` for the `export_yaml` mode. Keep them in sync.
- YAML is generated with `yaml.safe_dump(sort_keys=False, allow_unicode=True)` — do not add sorting.
