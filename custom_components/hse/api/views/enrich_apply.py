from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er

from ...catalogue_defaults import ensure_item_defaults
from ...const import API_PREFIX, DOMAIN
from ...scan_engine import detect_kind
from ...time_utils import utc_now_iso
from .enrich_preview import derive_base_slug
from .migration_export import _mk_integration_sensor_yaml, _mk_utility_meter_yaml, _safe_yaml

_HELPER_SYNC_ATTEMPTS = 3
_HELPER_SYNC_RETRY_DELAYS_S = (1.0, 1.5)
_HELPER_BG_MAX_PASSES = 8
_HELPER_BG_DELAY_S = 5.0
_HELPER_TASKS_KEY = "energy_helper_workflow_tasks"
_HELPER_WORKFLOW_SLOT = "helper_enrichment"


def _admin_only(request) -> bool:
    user = request.get("hass_user")
    return bool(user and getattr(user, "is_admin", False))


def _as_float_state(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    if not s or s in ("unknown", "unavailable", "none", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _has_config_entry_named(hass, *, domain: str, name: str) -> bool:
    try:
        entries = hass.config_entries.async_entries(domain)
    except Exception:  # noqa: BLE001
        return False

    for e in entries or []:
        try:
            if (e.title or "") == name:
                return True
            opts = getattr(e, "options", None) or {}
            if isinstance(opts, dict) and opts.get("name") == name:
                return True
        except Exception:  # noqa: BLE001
            continue

    return False


def _find_config_entry_by_name(hass, *, domain: str, name: str):
    try:
        entries = hass.config_entries.async_entries(domain)
    except Exception:  # noqa: BLE001
        return None

    for e in entries or []:
        try:
            if (e.title or "") == name:
                return e
            opts = getattr(e, "options", None) or {}
            if isinstance(opts, dict) and opts.get("name") == name:
                return e
        except Exception:  # noqa: BLE001
            continue

    return None


async def _remove_config_entry_if_present(hass, *, domain: str, name: str) -> bool:
    entry = _find_config_entry_by_name(hass, domain=domain, name=name)
    if entry is None:
        return False
    try:
        await hass.config_entries.async_remove(entry.entry_id)
        await hass.async_block_till_done()
        return True
    except Exception:  # noqa: BLE001
        return False


async def _wait_for_entity_or_registry(*, hass, ent_reg, entity_id: str, timeout_s: float = 5.0) -> bool:
    end = hass.loop.time() + timeout_s
    while hass.loop.time() < end:
        if hass.states.get(entity_id) is not None:
            return True
        if ent_reg.async_get(entity_id) is not None:
            return True
        await hass.async_block_till_done()
        await asyncio.sleep(0.2)
    return False


def _current_reference_entity_id(catalogue: dict | None) -> str | None:
    items = (catalogue or {}).get("items") or {}
    if not isinstance(items, dict):
        return None
    for item in items.values():
        if not isinstance(item, dict):
            continue
        enrichment = item.get("enrichment") or {}
        if not isinstance(enrichment, dict) or enrichment.get("is_reference_total") is not True:
            continue
        source = item.get("source") or {}
        entity_id = source.get("entity_id") if isinstance(source, dict) else None
        if isinstance(entity_id, str) and entity_id:
            return entity_id
    return None


def _find_catalogue_item_by_source_entity_id(catalogue: dict | None, entity_id: str) -> tuple[str | None, dict | None]:
    items = (catalogue or {}).get("items") or {}
    if not isinstance(items, dict):
        return None, None
    for item_id, item in items.items():
        if not isinstance(item, dict):
            continue
        source = item.get("source") or {}
        current_entity_id = source.get("entity_id") if isinstance(source, dict) else None
        if current_entity_id == entity_id:
            return item_id, item
    return None, None


def _energy_helper_entity_ids(base: str) -> dict[str, str]:
    return {
        "total": f"sensor.{base}_kwh_total",
        "day": f"sensor.{base}_kwh_day",
        "week": f"sensor.{base}_kwh_week",
        "month": f"sensor.{base}_kwh_month",
        "year": f"sensor.{base}_kwh_year",
    }


def _entity_exists(hass, ent_reg, entity_id: str | None) -> bool:
    if not isinstance(entity_id, str) or not entity_id:
        return False
    return hass.states.get(entity_id) is not None or ent_reg.async_get(entity_id) is not None


def _build_energy_helper_mapping(*, hass, ent_reg, power_entity_id: str, helper_entity_ids: dict[str, str]) -> dict:
    issues: list[str] = []
    resolved: dict[str, str | None] = {}

    for key in ("total", "day", "week", "month", "year"):
        entity_id = helper_entity_ids.get(key)
        if _entity_exists(hass, ent_reg, entity_id):
            resolved[key] = entity_id
        else:
            resolved[key] = None
            issues.append(f"missing:{key}")

    present_count = sum(1 for key in ("total", "day", "week", "month", "year") if resolved.get(key))
    if present_count == 5:
        status = "ready"
    elif present_count > 0:
        status = "partial"
    else:
        status = "unknown"

    return {
        "source_power_entity_id": power_entity_id,
        "total": resolved.get("total"),
        "day": resolved.get("day"),
        "week": resolved.get("week"),
        "month": resolved.get("month"),
        "year": resolved.get("year"),
        "status": status,
        "resolution_mode": "explicit",
        "last_resolved_at": utc_now_iso(),
        "issues": issues,
    }


def _persist_energy_helper_mapping(*, catalogue: dict | None, power_entity_id: str, mapping: dict) -> bool:
    if not isinstance(catalogue, dict):
        return False

    _item_id, item = _find_catalogue_item_by_source_entity_id(catalogue, power_entity_id)
    if item is None:
        return False

    ensure_item_defaults(item, base_entity_id=power_entity_id)
    derived = item.setdefault("derived", {})
    helpers = derived.setdefault("helpers", {})
    energy = helpers.setdefault("energy", {})
    energy.update(mapping)
    return True


def _energy_mapping_from_item(item: dict | None) -> dict | None:
    if not isinstance(item, dict):
        return None
    derived = item.get("derived") or {}
    helpers = derived.get("helpers") or {}
    mapping = helpers.get("energy")
    return mapping if isinstance(mapping, dict) else None


def _workflow_slot(item: dict, slot_name: str = _HELPER_WORKFLOW_SLOT) -> dict:
    workflow = item.setdefault("workflow", {})
    if not isinstance(workflow, dict):
        workflow = {}
        item["workflow"] = workflow

    slot = workflow.setdefault(slot_name, {})
    if not isinstance(slot, dict):
        slot = {}
        workflow[slot_name] = slot
    return slot


def _build_helper_status_payload(*, item_id: str | None, entity_id: str | None, workflow: dict | None, mapping: dict | None) -> dict:
    wf = workflow if isinstance(workflow, dict) else {}
    return {
        "job_id": wf.get("job_id"),
        "entity_id": entity_id,
        "item_id": item_id,
        "status": wf.get("status") or "idle",
        "progress_phase": wf.get("progress_phase") or "idle",
        "progress_label": wf.get("progress_label") or "Aucun enrichissement en cours.",
        "attempt": wf.get("attempt") or 0,
        "attempts_total": wf.get("attempts_total") or _HELPER_SYNC_ATTEMPTS,
        "will_retry": bool(wf.get("will_retry")),
        "retry_scheduled": bool(wf.get("retry_scheduled")),
        "done": bool(wf.get("done")),
        "last_error": wf.get("last_error"),
        "updated_at": wf.get("updated_at"),
        "started_at": wf.get("started_at"),
        "finished_at": wf.get("finished_at"),
        "mapping": mapping,
    }


def _set_helper_workflow_state(
    *,
    item: dict,
    item_id: str,
    entity_id: str | None,
    status: str,
    progress_phase: str,
    progress_label: str,
    attempt: int,
    attempts_total: int,
    will_retry: bool,
    retry_scheduled: bool,
    last_error: str | None = None,
    mapping: dict | None = None,
    done: bool | None = None,
    job_id: str | None = None,
    slot_name: str = _HELPER_WORKFLOW_SLOT,
) -> dict:
    slot = _workflow_slot(item, slot_name=slot_name)
    now = utc_now_iso()

    slot["job_id"] = job_id or slot.get("job_id") or str(uuid.uuid4())
    slot["status"] = status
    slot["progress_phase"] = progress_phase
    slot["progress_label"] = progress_label
    slot["attempt"] = attempt
    slot["attempts_total"] = attempts_total
    slot["will_retry"] = bool(will_retry)
    slot["retry_scheduled"] = bool(retry_scheduled)
    slot["last_error"] = last_error
    slot["updated_at"] = now
    slot["started_at"] = slot.get("started_at") or now
    slot["done"] = status in ("ready", "failed") if done is None else bool(done)

    if mapping is not None:
        slot["mapping"] = mapping

    if slot["done"]:
        slot["finished_at"] = now
    else:
        slot.pop("finished_at", None)

    return _build_helper_status_payload(
        item_id=item_id,
        entity_id=entity_id,
        workflow=slot,
        mapping=mapping if mapping is not None else slot.get("mapping"),
    )


async def _save_catalogue_if_possible(hass) -> None:
    domain_data = hass.data.get(DOMAIN, {})
    saver = domain_data.get("catalogue_save")
    if saver:
        await saver()


def _task_registry(hass) -> dict:
    domain_data = hass.data.setdefault(DOMAIN, {})
    registry = domain_data.get(_HELPER_TASKS_KEY)
    if not isinstance(registry, dict):
        registry = {}
        domain_data[_HELPER_TASKS_KEY] = registry
    return registry


def _cancel_helper_task(hass, entity_id: str | None) -> None:
    if not entity_id:
        return
    task = _task_registry(hass).pop(entity_id, None)
    if task and not task.done():
        task.cancel()


def _schedule_helper_task(*, hass, catalogue: dict, item_id: str, power_entity_id: str, safe_mode: bool, self_heal: bool, job_id: str) -> None:
    _cancel_helper_task(hass, power_entity_id)
    task = hass.async_create_task(
        _run_background_helper_enrichment(
            hass=hass,
            catalogue=catalogue,
            item_id=item_id,
            power_entity_id=power_entity_id,
            safe_mode=safe_mode,
            self_heal=self_heal,
            job_id=job_id,
        )
    )
    _task_registry(hass)[power_entity_id] = task


async def _try_create_helper_via_flow(*, hass, domain: str, data_variants: list[dict]) -> dict:
    """Best-effort helper creation via config flows."""

    flow_mgr = getattr(getattr(hass, "config_entries", None), "flow", None)
    if flow_mgr is None:
        return {"ok": False, "error": "config_entries_flow_not_available"}

    last_err = None
    sources = ("user",)

    for data in data_variants:
        for src in sources:
            try:
                res = await flow_mgr.async_init(domain, context={"source": src}, data=data)

                if isinstance(res, dict) and res.get("type") == "form" and res.get("flow_id"):
                    try:
                        res = await flow_mgr.async_configure(res["flow_id"], user_input=data)
                    except Exception as exc:  # noqa: BLE001
                        last_err = f"flow_configure_failed:{src}:{type(exc).__name__}:{exc}"
                        continue

                if isinstance(res, dict) and res.get("type") == "create_entry":
                    return {"ok": True, "result": res, "used_data": data, "already_configured": False}

                if isinstance(res, dict) and res.get("type") == "abort":
                    reason = res.get("reason") or "unknown"
                    if reason in ("already_configured", "single_instance_allowed"):
                        return {"ok": True, "result": res, "used_data": data, "already_configured": True}
                    last_err = f"flow_abort:{src}:{reason}"
                    continue

                last_err = f"flow_not_completed:{src}:{(res or {}).get('type') if isinstance(res, dict) else type(res).__name__}"
            except Exception as exc:  # noqa: BLE001
                last_err = f"flow_init_failed:{src}:{type(exc).__name__}:{exc}"

    return {"ok": False, "error": last_err or "unknown"}


async def _ensure_energy_helpers_once(*, hass, catalogue: dict | None, power_entity_id: str, safe_mode: bool, self_heal: bool) -> dict:
    ent_reg = er.async_get(hass)
    created: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []

    st = hass.states.get(power_entity_id)
    attrs = st.attributes if st else {}
    unit = (attrs or {}).get("unit_of_measurement")
    device_class = (attrs or {}).get("device_class")
    kind = detect_kind(device_class, unit)
    if kind != "power":
        return {
            "ok": False,
            "error": f"skip_kind:{kind}",
            "entity_id": power_entity_id,
            "created": created,
            "skipped": [{"entity_id": power_entity_id, "reason": f"skip_kind:{kind}", "hint": "Sélectionne un capteur de puissance (W/kW)."}],
            "errors": errors,
        }

    try:
        base = derive_base_slug(power_entity_id)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"base_slug:{exc}",
            "entity_id": power_entity_id,
            "created": created,
            "skipped": skipped,
            "errors": errors,
        }

    helper_entity_ids = _energy_helper_entity_ids(base)
    total_eid = helper_entity_ids["total"]
    total_name = f"{base}_kwh_total"

    power_value = _as_float_state(st.state if st else None)
    if safe_mode and power_value is None:
        mapping = _build_energy_helper_mapping(
            hass=hass,
            ent_reg=ent_reg,
            power_entity_id=power_entity_id,
            helper_entity_ids=helper_entity_ids,
        )
        persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
        if not persisted:
            errors.append({
                "entity_id": power_entity_id,
                "kind": "catalogue",
                "base": base,
                "error": "catalogue_item_not_found_for_helper_mapping",
            })
        skipped.append(
            {
                "entity_id": power_entity_id,
                "base": base,
                "reason": "power_not_ready",
                "hint": "Le capteur de puissance est unknown/unavailable. Attends une première mesure (allume une charge) puis relance.",
            }
        )
        return {
            "ok": False,
            "error": "power_not_ready",
            "entity_id": power_entity_id,
            "base": base,
            "created": created,
            "skipped": skipped,
            "errors": errors,
            "mapping": mapping,
        }

    reg_entry = ent_reg.async_get(total_eid)
    if hass.states.get(total_eid) is None and reg_entry is None:
        if _has_config_entry_named(hass, domain="integration", name=total_name):
            if self_heal:
                removed = await _remove_config_entry_if_present(hass, domain="integration", name=total_name)
                if removed:
                    skipped.append({"entity_id": total_eid, "reason": "self_heal_removed_stale_entry", "kind": "integration"})
                else:
                    mapping = _build_energy_helper_mapping(
                        hass=hass,
                        ent_reg=ent_reg,
                        power_entity_id=power_entity_id,
                        helper_entity_ids=helper_entity_ids,
                    )
                    persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
                    errors.append(
                        {
                            "entity_id": total_eid,
                            "kind": "integration",
                            "base": base,
                            "error": "config_entry_exists_but_entity_missing",
                            "hint": "Une config entry existe mais l'entité est absente. Va dans Settings → Devices & services → Helpers et supprime l'entrée, ou utilise enrich/cleanup.",
                        }
                    )
                    if not persisted:
                        errors.append({
                            "entity_id": power_entity_id,
                            "kind": "catalogue",
                            "base": base,
                            "error": "catalogue_item_not_found_for_helper_mapping",
                        })
                    return {
                        "ok": False,
                        "error": "integration_config_entry_exists_but_entity_missing",
                        "entity_id": power_entity_id,
                        "base": base,
                        "created": created,
                        "skipped": skipped,
                        "errors": errors,
                        "mapping": mapping,
                    }
            else:
                mapping = _build_energy_helper_mapping(
                    hass=hass,
                    ent_reg=ent_reg,
                    power_entity_id=power_entity_id,
                    helper_entity_ids=helper_entity_ids,
                )
                persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
                errors.append(
                    {
                        "entity_id": total_eid,
                        "kind": "integration",
                        "base": base,
                        "error": "config_entry_exists_but_entity_missing",
                    }
                )
                if not persisted:
                    errors.append({
                        "entity_id": power_entity_id,
                        "kind": "catalogue",
                        "base": base,
                        "error": "catalogue_item_not_found_for_helper_mapping",
                    })
                return {
                    "ok": False,
                    "error": "integration_config_entry_exists_but_entity_missing",
                    "entity_id": power_entity_id,
                    "base": base,
                    "created": created,
                    "skipped": skipped,
                    "errors": errors,
                    "mapping": mapping,
                }

        data_variants = [
            {"source": power_entity_id, "name": total_name, "unit_prefix": "k", "unit_time": "h", "round": 3, "method": "left"},
            {"source_entity_id": power_entity_id, "name": total_name, "unit_prefix": "k", "unit_time": "h", "round": 3, "method": "left"},
            {"source_sensor": power_entity_id, "name": total_name, "unit_prefix": "k", "unit_time": "h", "round": 3, "method": "left"},
        ]
        res = await _try_create_helper_via_flow(hass=hass, domain="integration", data_variants=data_variants)
        if res.get("ok"):
            if res.get("already_configured"):
                skipped.append({"entity_id": total_eid, "reason": "already_configured", "flow": res.get("result")})
            else:
                created.append({"entity_id": total_eid, "kind": "integration", "base": base, "flow": res.get("result")})

            ok = await _wait_for_entity_or_registry(hass=hass, ent_reg=ent_reg, entity_id=total_eid, timeout_s=6.0)
            if not ok:
                if self_heal:
                    await _remove_config_entry_if_present(hass, domain="integration", name=total_name)
                mapping = _build_energy_helper_mapping(
                    hass=hass,
                    ent_reg=ent_reg,
                    power_entity_id=power_entity_id,
                    helper_entity_ids=helper_entity_ids,
                )
                persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
                errors.append(
                    {
                        "entity_id": total_eid,
                        "kind": "integration",
                        "base": base,
                        "error": "entity_not_created_after_flow",
                        "rolled_back": bool(self_heal),
                        "hint": "L'entité n'a pas été créée après le flow. Vérifie Settings → System → Logs (filtre 'integration').",
                    }
                )
                if not persisted:
                    errors.append({
                        "entity_id": power_entity_id,
                        "kind": "catalogue",
                        "base": base,
                        "error": "catalogue_item_not_found_for_helper_mapping",
                    })
                return {
                    "ok": False,
                    "error": "integration_entity_not_created_after_flow",
                    "entity_id": power_entity_id,
                    "base": base,
                    "created": created,
                    "skipped": skipped,
                    "errors": errors,
                    "mapping": mapping,
                }
        else:
            mapping = _build_energy_helper_mapping(
                hass=hass,
                ent_reg=ent_reg,
                power_entity_id=power_entity_id,
                helper_entity_ids=helper_entity_ids,
            )
            persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
            errors.append(
                {
                    "entity_id": total_eid,
                    "kind": "integration",
                    "base": base,
                    "error": res.get("error"),
                    "hint": "Échec du config flow. Vérifie Settings → System → Logs.",
                }
            )
            if not persisted:
                errors.append({
                    "entity_id": power_entity_id,
                    "kind": "catalogue",
                    "base": base,
                    "error": "catalogue_item_not_found_for_helper_mapping",
                })
            return {
                "ok": False,
                "error": res.get("error") or "integration_flow_failed",
                "entity_id": power_entity_id,
                "base": base,
                "created": created,
                "skipped": skipped,
                "errors": errors,
                "mapping": mapping,
            }
    else:
        skipped.append({"entity_id": total_eid, "reason": "already_exists_or_registered", "registry": bool(reg_entry)})

    total_state = hass.states.get(total_eid)
    total_value = _as_float_state(total_state.state if total_state else None)
    if safe_mode and total_value is None:
        mapping = _build_energy_helper_mapping(
            hass=hass,
            ent_reg=ent_reg,
            power_entity_id=power_entity_id,
            helper_entity_ids=helper_entity_ids,
        )
        persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
        skipped.append(
            {
                "entity_id": total_eid,
                "base": base,
                "reason": "total_not_ready",
                "hint": "Le compteur kWh total est encore unknown. HSE relancera automatiquement la finalisation des compteurs day/week/month/year.",
            }
        )
        if not persisted:
            errors.append({
                "entity_id": power_entity_id,
                "kind": "catalogue",
                "base": base,
                "error": "catalogue_item_not_found_for_helper_mapping",
            })
        return {
            "ok": False,
            "error": "total_not_ready",
            "entity_id": power_entity_id,
            "base": base,
            "created": created,
            "skipped": skipped,
            "errors": errors,
            "mapping": mapping,
        }

    for suf, cycle in (("day", "daily"), ("week", "weekly"), ("month", "monthly"), ("year", "yearly")):
        meter_name = f"{base}_kwh_{suf}"
        meter_eid = helper_entity_ids[suf]
        reg_meter = ent_reg.async_get(meter_eid)

        if hass.states.get(meter_eid) is not None or reg_meter is not None:
            skipped.append({"entity_id": meter_eid, "reason": "already_exists_or_registered", "registry": bool(reg_meter)})
            continue

        if _has_config_entry_named(hass, domain="utility_meter", name=meter_name):
            if self_heal:
                removed = await _remove_config_entry_if_present(hass, domain="utility_meter", name=meter_name)
                if removed:
                    skipped.append({"entity_id": meter_eid, "reason": "self_heal_removed_stale_entry", "kind": "utility_meter"})
                else:
                    errors.append(
                        {
                            "entity_id": meter_eid,
                            "kind": "utility_meter",
                            "base": base,
                            "cycle": cycle,
                            "error": "config_entry_exists_but_entity_missing",
                            "hint": "Une config entry existe mais l'entité est absente. Supprime l'entrée dans Helpers, ou utilise enrich/cleanup.",
                        }
                    )
                    continue
            else:
                skipped.append({"entity_id": meter_eid, "reason": "config_entry_exists"})
                continue

        base_payload = {
            "source": total_eid,
            "name": meter_name,
            "cycle": cycle,
            "offset": 0.0,
            "tariffs": [],
            "delta_values": False,
            "net_consumption": False,
            "periodically_resetting": False,
            "always_available": False,
        }
        data_variants = [
            base_payload,
            {**base_payload, "source_sensor": total_eid},
            {**base_payload, "source_entity_id": total_eid},
            {**base_payload, "meter_id": meter_name},
        ]

        res = await _try_create_helper_via_flow(hass=hass, domain="utility_meter", data_variants=data_variants)
        if res.get("ok"):
            if res.get("already_configured"):
                skipped.append({"entity_id": meter_eid, "reason": "already_configured", "flow": res.get("result")})
            else:
                created.append({"entity_id": meter_eid, "kind": "utility_meter", "base": base, "cycle": cycle, "flow": res.get("result")})

            ok = await _wait_for_entity_or_registry(hass=hass, ent_reg=ent_reg, entity_id=meter_eid, timeout_s=6.0)
            if not ok:
                if self_heal:
                    await _remove_config_entry_if_present(hass, domain="utility_meter", name=meter_name)
                errors.append(
                    {
                        "entity_id": meter_eid,
                        "kind": "utility_meter",
                        "base": base,
                        "cycle": cycle,
                        "error": "entity_not_created_after_flow",
                        "rolled_back": bool(self_heal),
                        "hint": "L'entité n'a pas été créée après le flow. Vérifie Settings → System → Logs (filtre 'utility_meter').",
                    }
                )
                continue

            await hass.async_block_till_done()
        else:
            errors.append({"entity_id": meter_eid, "kind": "utility_meter", "base": base, "cycle": cycle, "error": res.get("error")})

    mapping = _build_energy_helper_mapping(
        hass=hass,
        ent_reg=ent_reg,
        power_entity_id=power_entity_id,
        helper_entity_ids=helper_entity_ids,
    )
    persisted = _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
    if not persisted:
        errors.append({
            "entity_id": power_entity_id,
            "kind": "catalogue",
            "base": base,
            "error": "catalogue_item_not_found_for_helper_mapping",
        })

    return {
        "ok": mapping.get("status") in ("ready", "partial"),
        "entity_id": power_entity_id,
        "base": base,
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "mapping": mapping,
    }


async def _run_background_helper_enrichment(*, hass, catalogue: dict, item_id: str, power_entity_id: str, safe_mode: bool, self_heal: bool, job_id: str) -> None:
    try:
        for pass_index in range(1, _HELPER_BG_MAX_PASSES + 1):
            current_item_id, item = _find_catalogue_item_by_source_entity_id(catalogue, power_entity_id)
            if not item or current_item_id != item_id:
                return

            _set_helper_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="running",
                progress_phase="ensure_total",
                progress_label="Finalisation des helpers en arrière-plan…",
                attempt=_HELPER_SYNC_ATTEMPTS,
                attempts_total=_HELPER_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=True,
                last_error="total_not_ready",
                mapping=_energy_mapping_from_item(item),
                done=False,
                job_id=job_id,
            )
            await _save_catalogue_if_possible(hass)

            result = await _ensure_energy_helpers_once(
                hass=hass,
                catalogue=catalogue,
                power_entity_id=power_entity_id,
                safe_mode=safe_mode,
                self_heal=self_heal,
            )
            mapping = result.get("mapping") or _energy_mapping_from_item(item)

            if result.get("ok"):
                _set_helper_workflow_state(
                    item=item,
                    item_id=item_id,
                    entity_id=power_entity_id,
                    status="ready",
                    progress_phase="ready",
                    progress_label="Helpers énergie prêts",
                    attempt=_HELPER_SYNC_ATTEMPTS,
                    attempts_total=_HELPER_SYNC_ATTEMPTS,
                    will_retry=False,
                    retry_scheduled=False,
                    last_error=None,
                    mapping=mapping,
                    done=True,
                    job_id=job_id,
                )
                await _save_catalogue_if_possible(hass)
                return

            error = result.get("error")
            if error != "total_not_ready":
                _set_helper_workflow_state(
                    item=item,
                    item_id=item_id,
                    entity_id=power_entity_id,
                    status="failed",
                    progress_phase="failed",
                    progress_label="Création des helpers incomplète.",
                    attempt=_HELPER_SYNC_ATTEMPTS,
                    attempts_total=_HELPER_SYNC_ATTEMPTS,
                    will_retry=False,
                    retry_scheduled=False,
                    last_error=error,
                    mapping=mapping,
                    done=True,
                    job_id=job_id,
                )
                await _save_catalogue_if_possible(hass)
                return

            if pass_index >= _HELPER_BG_MAX_PASSES:
                _set_helper_workflow_state(
                    item=item,
                    item_id=item_id,
                    entity_id=power_entity_id,
                    status="failed",
                    progress_phase="failed",
                    progress_label="Création des helpers expirée.",
                    attempt=_HELPER_SYNC_ATTEMPTS,
                    attempts_total=_HELPER_SYNC_ATTEMPTS,
                    will_retry=False,
                    retry_scheduled=False,
                    last_error=error,
                    mapping=mapping,
                    done=True,
                    job_id=job_id,
                )
                await _save_catalogue_if_possible(hass)
                return

            _set_helper_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="pending_background",
                progress_phase="pending_background",
                progress_label="Helpers partiels, nouvelle tentative en arrière-plan…",
                attempt=_HELPER_SYNC_ATTEMPTS,
                attempts_total=_HELPER_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=True,
                last_error=error,
                mapping=mapping,
                done=False,
                job_id=job_id,
            )
            await _save_catalogue_if_possible(hass)
            await asyncio.sleep(_HELPER_BG_DELAY_S)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        current_item_id, item = _find_catalogue_item_by_source_entity_id(catalogue, power_entity_id)
        if item and current_item_id == item_id:
            _set_helper_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="failed",
                progress_phase="failed",
                progress_label="Création des helpers interrompue.",
                attempt=_HELPER_SYNC_ATTEMPTS,
                attempts_total=_HELPER_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=False,
                last_error=str(exc),
                mapping=_energy_mapping_from_item(item),
                done=True,
                job_id=job_id,
            )
            await _save_catalogue_if_possible(hass)
    finally:
        registry = _task_registry(hass)
        current = registry.get(power_entity_id)
        if current is asyncio.current_task():
            registry.pop(power_entity_id, None)


async def _run_standard_enrichment_workflow(*, hass, catalogue: dict, power_entity_id: str, safe_mode: bool, self_heal: bool) -> dict | None:
    item_id, item = _find_catalogue_item_by_source_entity_id(catalogue, power_entity_id)
    if not item:
        return None

    aggregate_created: list[dict] = []
    aggregate_skipped: list[dict] = []
    aggregate_errors: list[dict] = []

    initial = _set_helper_workflow_state(
        item=item,
        item_id=item_id,
        entity_id=power_entity_id,
        status="running",
        progress_phase="ensure_total",
        progress_label="Création des helpers énergie…",
        attempt=0,
        attempts_total=_HELPER_SYNC_ATTEMPTS,
        will_retry=False,
        retry_scheduled=False,
        last_error=None,
        mapping=_energy_mapping_from_item(item),
        done=False,
    )
    await _save_catalogue_if_possible(hass)

    for attempt in range(1, _HELPER_SYNC_ATTEMPTS + 1):
        _set_helper_workflow_state(
            item=item,
            item_id=item_id,
            entity_id=power_entity_id,
            status="running",
            progress_phase="ensure_total",
            progress_label=f"Création du helper total… tentative {attempt}/{_HELPER_SYNC_ATTEMPTS}",
            attempt=attempt,
            attempts_total=_HELPER_SYNC_ATTEMPTS,
            will_retry=False,
            retry_scheduled=False,
            last_error=None,
            mapping=_energy_mapping_from_item(item),
            done=False,
            job_id=initial.get("job_id"),
        )
        await _save_catalogue_if_possible(hass)

        result = await _ensure_energy_helpers_once(
            hass=hass,
            catalogue=catalogue,
            power_entity_id=power_entity_id,
            safe_mode=safe_mode,
            self_heal=self_heal,
        )
        aggregate_created.extend(result.get("created") or [])
        aggregate_skipped.extend(result.get("skipped") or [])
        aggregate_errors.extend(result.get("errors") or [])
        mapping = result.get("mapping") or _energy_mapping_from_item(item)

        if result.get("ok"):
            status_payload = _set_helper_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="ready",
                progress_phase="ready",
                progress_label="Helpers énergie prêts",
                attempt=attempt,
                attempts_total=_HELPER_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=False,
                last_error=None,
                mapping=mapping,
                done=True,
                job_id=initial.get("job_id"),
            )
            await _save_catalogue_if_possible(hass)
            return {
                **result,
                "created": aggregate_created,
                "skipped": aggregate_skipped,
                "errors": aggregate_errors,
                "helper_status": status_payload,
            }

        error = result.get("error")
        if error == "total_not_ready" and attempt < _HELPER_SYNC_ATTEMPTS:
            _set_helper_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="running",
                progress_phase="retry_wait",
                progress_label=f"Helper total pas encore prêt, nouvelle tentative… ({attempt + 1}/{_HELPER_SYNC_ATTEMPTS})",
                attempt=attempt,
                attempts_total=_HELPER_SYNC_ATTEMPTS,
                will_retry=True,
                retry_scheduled=False,
                last_error=error,
                mapping=mapping,
                done=False,
                job_id=initial.get("job_id"),
            )
            await _save_catalogue_if_possible(hass)
            await asyncio.sleep(_HELPER_SYNC_RETRY_DELAYS_S[attempt - 1])
            continue

        if error == "total_not_ready":
            status_payload = _set_helper_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="pending_background",
                progress_phase="pending_background",
                progress_label="Helpers partiels, finalisation en arrière-plan…",
                attempt=attempt,
                attempts_total=_HELPER_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=True,
                last_error=error,
                mapping=mapping,
                done=False,
                job_id=initial.get("job_id"),
            )
            await _save_catalogue_if_possible(hass)
            _schedule_helper_task(
                hass=hass,
                catalogue=catalogue,
                item_id=item_id,
                power_entity_id=power_entity_id,
                safe_mode=safe_mode,
                self_heal=self_heal,
                job_id=status_payload.get("job_id") or initial.get("job_id"),
            )
            return {
                **result,
                "created": aggregate_created,
                "skipped": aggregate_skipped,
                "errors": aggregate_errors,
                "helper_status": status_payload,
            }

        status_payload = _set_helper_workflow_state(
            item=item,
            item_id=item_id,
            entity_id=power_entity_id,
            status="failed",
            progress_phase="failed",
            progress_label="Création des helpers incomplète.",
            attempt=attempt,
            attempts_total=_HELPER_SYNC_ATTEMPTS,
            will_retry=False,
            retry_scheduled=False,
            last_error=error,
            mapping=mapping,
            done=True,
            job_id=initial.get("job_id"),
        )
        await _save_catalogue_if_possible(hass)
        return {
            **result,
            "created": aggregate_created,
            "skipped": aggregate_skipped,
            "errors": aggregate_errors,
            "helper_status": status_payload,
        }

    return None


class EnrichApplyView(HomeAssistantView):
    url = f"{API_PREFIX}/enrich/apply"
    name = "hse:unified:enrich_apply"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]

        if not _admin_only(request):
            return self.json({"error": "admin_required"}, status_code=403)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        mode = body.get("mode")
        if mode not in ("create_helpers", "export_yaml"):
            mode = "create_helpers"

        safe_mode = body.get("safe", True)
        self_heal = body.get("self_heal", True)

        domain_data = hass.data.get(DOMAIN, {})
        catalogue = domain_data.get("catalogue") or {}

        entity_ids = body.get("entity_ids")
        if not isinstance(entity_ids, list) or not entity_ids:
            settings = catalogue.get("settings") if isinstance(catalogue, dict) else {}
            pricing = settings.get("pricing") if isinstance(settings, dict) else {}
            cids = pricing.get("cost_entity_ids") if isinstance(pricing, dict) else []
            entity_ids = [x for x in cids if isinstance(x, str) and x]

            reference_entity_id = _current_reference_entity_id(catalogue)
            if reference_entity_id and reference_entity_id not in entity_ids:
                entity_ids.append(reference_entity_id)
        else:
            entity_ids = [x for x in entity_ids if isinstance(x, str) and x]

        seen: set[str] = set()
        entity_ids = [x for x in entity_ids if not (x in seen or seen.add(x))]

        created: list[dict] = []
        skipped: list[dict] = []
        errors: list[dict] = []
        decisions_required: list[dict] = []
        helper_statuses: list[dict] = []

        bases = {}
        for eid in entity_ids:
            st = hass.states.get(eid)
            attrs = st.attributes if st else {}
            unit = (attrs or {}).get("unit_of_measurement")
            device_class = (attrs or {}).get("device_class")
            kind = detect_kind(device_class, unit)
            if kind != "power":
                skipped.append({"entity_id": eid, "reason": f"skip_kind:{kind}", "hint": "Sélectionne un capteur de puissance (W/kW)."})
                continue

            try:
                base = derive_base_slug(eid)
            except Exception as exc:  # noqa: BLE001
                decisions_required.append({"code": "base_slug", "reason": str(exc), "power_entity_id": eid})
                continue

            info = bases.setdefault(base, {"base": base, "power_entity_id": eid})
            info["power_entity_id"] = eid

        integration_sensors = []
        utility_meter_block = {}

        for base, info in sorted(bases.items()):
            power_eid = info.get("power_entity_id")
            energy_total_eid = f"sensor.{base}_kwh_total"

            if power_eid:
                integration_sensors.append(_mk_integration_sensor_yaml(power_eid, energy_total_eid))
                utility_meter_block.update(_mk_utility_meter_yaml(energy_total_eid, base))

        exports = {
            "option2_templates_riemann_yaml": _safe_yaml({"sensor": integration_sensors}) if integration_sensors else "# Rien à générer\n",
            "option1_utility_meter_yaml": _safe_yaml({"utility_meter": utility_meter_block}) if utility_meter_block else "# Rien à générer\n",
        }

        if mode == "create_helpers":
            for base, info in sorted(bases.items()):
                power_eid = info.get("power_entity_id")
                if not power_eid:
                    skipped.append({"entity_id": base, "reason": "missing_power_entity"})
                    continue

                result = await _run_standard_enrichment_workflow(
                    hass=hass,
                    catalogue=catalogue,
                    power_entity_id=power_eid,
                    safe_mode=safe_mode,
                    self_heal=self_heal,
                )
                if result is None:
                    errors.append({
                        "entity_id": power_eid,
                        "kind": "catalogue",
                        "base": base,
                        "error": "catalogue_item_not_found_for_helper_mapping",
                    })
                    continue

                created.extend(result.get("created") or [])
                skipped.extend(result.get("skipped") or [])
                errors.extend(result.get("errors") or [])
                status = result.get("helper_status")
                if isinstance(status, dict):
                    helper_statuses.append(status)
        else:
            for base in sorted(bases.keys()):
                skipped.append({"entity_id": f"sensor.{base}_kwh_total", "reason": "export_ready"})

        return self.json(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "mode": mode,
                "input": {"entity_ids": entity_ids, "safe": safe_mode, "self_heal": self_heal},
                "summary": {
                    "created_count": len(created),
                    "skipped_count": len(skipped),
                    "errors_count": len(errors),
                    "decisions_required_count": len(decisions_required),
                },
                "created": created,
                "skipped": skipped,
                "errors": errors,
                "decisions_required": decisions_required,
                "helper_statuses": helper_statuses,
                "exports": exports,
            }
        )
