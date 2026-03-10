"""HSE_DOC: custom_components/hse/docs/persistent_catalogue.md
HSE_MAINTENANCE: If you change reference_total semantics, update the doc above.
"""

from __future__ import annotations

import asyncio
import uuid

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er

from ...const import API_PREFIX, DOMAIN
from ...scan_engine import detect_kind
from ...time_utils import utc_now_iso
from .enrich_apply import (
    _as_float_state,
    _build_energy_helper_mapping,
    _energy_helper_entity_ids,
    _has_config_entry_named,
    _persist_energy_helper_mapping,
    _remove_config_entry_if_present,
    _try_create_helper_via_flow,
    _wait_for_entity_or_registry,
)
from .enrich_preview import derive_base_slug

_REFERENCE_TOTAL_STATUS_URL = f"{API_PREFIX}/catalogue/reference_total/status"
_REFERENCE_SYNC_ATTEMPTS = 3
_REFERENCE_SYNC_RETRY_DELAYS_S = (1.0, 1.5)
_REFERENCE_BG_MAX_PASSES = 8
_REFERENCE_BG_DELAY_S = 5.0
_REFERENCE_TASKS_KEY = "reference_total_workflow_tasks"


async def _ensure_reference_energy_helpers(*, hass, catalogue: dict, power_entity_id: str) -> dict:
    ent_reg = er.async_get(hass)

    st = hass.states.get(power_entity_id)
    attrs = st.attributes if st else {}
    unit = (attrs or {}).get("unit_of_measurement")
    device_class = (attrs or {}).get("device_class")
    kind = detect_kind(device_class, unit)
    if kind != "power":
        return {"ok": False, "error": f"skip_kind:{kind}", "entity_id": power_entity_id}

    try:
        base = derive_base_slug(power_entity_id)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"base_slug:{exc}", "entity_id": power_entity_id}

    helper_entity_ids = _energy_helper_entity_ids(base)
    total_eid = helper_entity_ids["total"]
    total_name = f"{base}_kwh_total"
    created: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    power_value = _as_float_state(st.state if st else None)
    if power_value is None:
        mapping = _build_energy_helper_mapping(
            hass=hass,
            ent_reg=ent_reg,
            power_entity_id=power_entity_id,
            helper_entity_ids=helper_entity_ids,
        )
        _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
        return {
            "ok": False,
            "error": "power_not_ready",
            "entity_id": power_entity_id,
            "mapping": mapping,
        }

    reg_entry = ent_reg.async_get(total_eid)
    if hass.states.get(total_eid) is None and reg_entry is None:
        if _has_config_entry_named(hass, domain="integration", name=total_name):
            removed = await _remove_config_entry_if_present(hass, domain="integration", name=total_name)
            if removed:
                skipped.append(f"self_heal_removed:{total_eid}")
            else:
                mapping = _build_energy_helper_mapping(
                    hass=hass,
                    ent_reg=ent_reg,
                    power_entity_id=power_entity_id,
                    helper_entity_ids=helper_entity_ids,
                )
                _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
                return {
                    "ok": False,
                    "error": "integration_config_entry_exists_but_entity_missing",
                    "entity_id": power_entity_id,
                    "mapping": mapping,
                }

        data_variants = [
            {"source": power_entity_id, "name": total_name, "unit_prefix": "k", "unit_time": "h", "round": 3, "method": "left"},
            {"source_entity_id": power_entity_id, "name": total_name, "unit_prefix": "k", "unit_time": "h", "round": 3, "method": "left"},
            {"source_sensor": power_entity_id, "name": total_name, "unit_prefix": "k", "unit_time": "h", "round": 3, "method": "left"},
        ]
        res = await _try_create_helper_via_flow(hass=hass, domain="integration", data_variants=data_variants)
        if not res.get("ok"):
            mapping = _build_energy_helper_mapping(
                hass=hass,
                ent_reg=ent_reg,
                power_entity_id=power_entity_id,
                helper_entity_ids=helper_entity_ids,
            )
            _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
            return {
                "ok": False,
                "error": res.get("error"),
                "entity_id": power_entity_id,
                "mapping": mapping,
            }
        created.append(total_eid)
        ok = await _wait_for_entity_or_registry(hass=hass, ent_reg=ent_reg, entity_id=total_eid, timeout_s=6.0)
        if not ok:
            await _remove_config_entry_if_present(hass, domain="integration", name=total_name)
            mapping = _build_energy_helper_mapping(
                hass=hass,
                ent_reg=ent_reg,
                power_entity_id=power_entity_id,
                helper_entity_ids=helper_entity_ids,
            )
            _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
            return {
                "ok": False,
                "error": "integration_entity_not_created_after_flow",
                "entity_id": power_entity_id,
                "mapping": mapping,
            }
    else:
        skipped.append(f"already_exists:{total_eid}")

    total_state = hass.states.get(total_eid)
    total_value = _as_float_state(total_state.state if total_state else None)
    if total_value is None:
        mapping = _build_energy_helper_mapping(
            hass=hass,
            ent_reg=ent_reg,
            power_entity_id=power_entity_id,
            helper_entity_ids=helper_entity_ids,
        )
        _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)
        return {
            "ok": False,
            "error": "total_not_ready",
            "entity_id": power_entity_id,
            "mapping": mapping,
        }

    for suf, cycle in (("day", "daily"), ("week", "weekly"), ("month", "monthly"), ("year", "yearly")):
        meter_name = f"{base}_kwh_{suf}"
        meter_eid = helper_entity_ids[suf]
        reg_meter = ent_reg.async_get(meter_eid)

        if hass.states.get(meter_eid) is not None or reg_meter is not None:
            skipped.append(f"already_exists:{meter_eid}")
            continue

        if _has_config_entry_named(hass, domain="utility_meter", name=meter_name):
            removed = await _remove_config_entry_if_present(hass, domain="utility_meter", name=meter_name)
            if removed:
                skipped.append(f"self_heal_removed:{meter_eid}")
            else:
                errors.append(f"config_entry_exists_but_entity_missing:{meter_eid}")
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
        if not res.get("ok"):
            errors.append(f"flow_error:{meter_eid}:{res.get('error')}")
            continue

        created.append(meter_eid)
        ok = await _wait_for_entity_or_registry(hass=hass, ent_reg=ent_reg, entity_id=meter_eid, timeout_s=6.0)
        if not ok:
            await _remove_config_entry_if_present(hass, domain="utility_meter", name=meter_name)
            errors.append(f"entity_not_created_after_flow:{meter_eid}")
            continue

        await hass.async_block_till_done()

    mapping = _build_energy_helper_mapping(
        hass=hass,
        ent_reg=ent_reg,
        power_entity_id=power_entity_id,
        helper_entity_ids=helper_entity_ids,
    )
    _persist_energy_helper_mapping(catalogue=catalogue, power_entity_id=power_entity_id, mapping=mapping)

    return {
        "ok": mapping.get("status") in ("ready", "partial"),
        "entity_id": power_entity_id,
        "base": base,
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "mapping": mapping,
    }


def _catalogue_items(catalogue: dict) -> dict:
    items = (catalogue or {}).get("items") or {}
    return items if isinstance(items, dict) else {}


def _find_catalogue_item_by_entity_id(catalogue: dict, entity_id: str | None):
    if not entity_id:
        return None, None

    for item_id, item in (_catalogue_items(catalogue).items() or []):
        if not isinstance(item, dict):
            continue
        src = item.get("source") or {}
        if src.get("entity_id") == entity_id:
            return item_id, item

    return None, None


def _find_current_reference_item(catalogue: dict):
    for item_id, item in (_catalogue_items(catalogue).items() or []):
        if not isinstance(item, dict):
            continue
        enr = item.get("enrichment") or {}
        if enr.get("is_reference_total") is True:
            src = item.get("source") or {}
            return item_id, item, src.get("entity_id")
    return None, None, None


def _workflow_slot(item: dict) -> dict:
    workflow = item.setdefault("workflow", {})
    if not isinstance(workflow, dict):
        workflow = {}
        item["workflow"] = workflow

    slot = workflow.setdefault("reference_enrichment", {})
    if not isinstance(slot, dict):
        slot = {}
        workflow["reference_enrichment"] = slot

    return slot


def _energy_mapping_from_item(item: dict | None) -> dict | None:
    if not isinstance(item, dict):
        return None
    derived = item.get("derived") or {}
    helpers = derived.get("helpers") or {}
    mapping = helpers.get("energy")
    return mapping if isinstance(mapping, dict) else None


def _build_reference_status_payload(*, item_id: str | None, entity_id: str | None, workflow: dict | None, mapping: dict | None) -> dict:
    wf = workflow if isinstance(workflow, dict) else {}
    return {
        "job_id": wf.get("job_id"),
        "entity_id": entity_id,
        "item_id": item_id,
        "status": wf.get("status") or "idle",
        "progress_phase": wf.get("progress_phase") or "idle",
        "progress_label": wf.get("progress_label") or "Aucun enrichissement en cours.",
        "attempt": wf.get("attempt") or 0,
        "attempts_total": wf.get("attempts_total") or _REFERENCE_SYNC_ATTEMPTS,
        "will_retry": bool(wf.get("will_retry")),
        "retry_scheduled": bool(wf.get("retry_scheduled")),
        "done": bool(wf.get("done")),
        "last_error": wf.get("last_error"),
        "updated_at": wf.get("updated_at"),
        "started_at": wf.get("started_at"),
        "finished_at": wf.get("finished_at"),
        "mapping": mapping,
    }


def _set_reference_workflow_state(
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
) -> dict:
    slot = _workflow_slot(item)
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

    return _build_reference_status_payload(
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
    registry = domain_data.get(_REFERENCE_TASKS_KEY)
    if not isinstance(registry, dict):
        registry = {}
        domain_data[_REFERENCE_TASKS_KEY] = registry
    return registry


def _cancel_reference_task(hass, entity_id: str | None) -> None:
    if not entity_id:
        return
    task = _task_registry(hass).pop(entity_id, None)
    if task and not task.done():
        task.cancel()


def _schedule_reference_task(*, hass, catalogue: dict, item_id: str, power_entity_id: str, job_id: str) -> None:
    _cancel_reference_task(hass, power_entity_id)
    task = hass.async_create_task(
        _run_reference_background_enrichment(
            hass=hass,
            catalogue=catalogue,
            item_id=item_id,
            power_entity_id=power_entity_id,
            job_id=job_id,
        )
    )
    _task_registry(hass)[power_entity_id] = task


async def _run_reference_background_enrichment(*, hass, catalogue: dict, item_id: str, power_entity_id: str, job_id: str) -> None:
    try:
        for pass_index in range(1, _REFERENCE_BG_MAX_PASSES + 1):
            current_item_id, item = _find_catalogue_item_by_entity_id(catalogue, power_entity_id)
            if not item or current_item_id != item_id:
                return

            enr = item.get("enrichment") or {}
            if enr.get("is_reference_total") is not True:
                return

            _set_reference_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="running",
                progress_phase="ensure_total",
                progress_label="Finalisation des helpers en arrière-plan…",
                attempt=_REFERENCE_SYNC_ATTEMPTS,
                attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=True,
                last_error="total_not_ready",
                mapping=_energy_mapping_from_item(item),
                done=False,
                job_id=job_id,
            )
            await _save_catalogue_if_possible(hass)

            result = await _ensure_reference_energy_helpers(
                hass=hass,
                catalogue=catalogue,
                power_entity_id=power_entity_id,
            )
            mapping = result.get("mapping") or _energy_mapping_from_item(item)

            if result.get("ok"):
                _set_reference_workflow_state(
                    item=item,
                    item_id=item_id,
                    entity_id=power_entity_id,
                    status="ready",
                    progress_phase="ready",
                    progress_label="Référence prête",
                    attempt=_REFERENCE_SYNC_ATTEMPTS,
                    attempts_total=_REFERENCE_SYNC_ATTEMPTS,
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
                _set_reference_workflow_state(
                    item=item,
                    item_id=item_id,
                    entity_id=power_entity_id,
                    status="failed",
                    progress_phase="failed",
                    progress_label="Référence enregistrée, mais la finalisation a échoué.",
                    attempt=_REFERENCE_SYNC_ATTEMPTS,
                    attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                    will_retry=False,
                    retry_scheduled=False,
                    last_error=error,
                    mapping=mapping,
                    done=True,
                    job_id=job_id,
                )
                await _save_catalogue_if_possible(hass)
                return

            if pass_index >= _REFERENCE_BG_MAX_PASSES:
                _set_reference_workflow_state(
                    item=item,
                    item_id=item_id,
                    entity_id=power_entity_id,
                    status="failed",
                    progress_phase="failed",
                    progress_label="Référence enregistrée, mais la finalisation a expiré.",
                    attempt=_REFERENCE_SYNC_ATTEMPTS,
                    attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                    will_retry=False,
                    retry_scheduled=False,
                    last_error=error,
                    mapping=mapping,
                    done=True,
                    job_id=job_id,
                )
                await _save_catalogue_if_possible(hass)
                return

            _set_reference_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="pending_background",
                progress_phase="pending_background",
                progress_label="Référence enregistrée, finalisation des helpers en arrière-plan…",
                attempt=_REFERENCE_SYNC_ATTEMPTS,
                attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=True,
                last_error=error,
                mapping=mapping,
                done=False,
                job_id=job_id,
            )
            await _save_catalogue_if_possible(hass)
            await asyncio.sleep(_REFERENCE_BG_DELAY_S)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        current_item_id, item = _find_catalogue_item_by_entity_id(catalogue, power_entity_id)
        if item and current_item_id == item_id:
            _set_reference_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="failed",
                progress_phase="failed",
                progress_label="Référence enregistrée, mais la finalisation a échoué.",
                attempt=_REFERENCE_SYNC_ATTEMPTS,
                attempts_total=_REFERENCE_SYNC_ATTEMPTS,
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


async def _run_reference_enrichment_workflow(*, hass, catalogue: dict, item_id: str, power_entity_id: str) -> dict | None:
    _, item = _find_catalogue_item_by_entity_id(catalogue, power_entity_id)
    if not item:
        return None

    initial = _set_reference_workflow_state(
        item=item,
        item_id=item_id,
        entity_id=power_entity_id,
        status="running",
        progress_phase="saving_reference",
        progress_label="Enregistrement de la référence…",
        attempt=0,
        attempts_total=_REFERENCE_SYNC_ATTEMPTS,
        will_retry=False,
        retry_scheduled=False,
        last_error=None,
        mapping=_energy_mapping_from_item(item),
        done=False,
    )
    await _save_catalogue_if_possible(hass)

    for attempt in range(1, _REFERENCE_SYNC_ATTEMPTS + 1):
        _set_reference_workflow_state(
            item=item,
            item_id=item_id,
            entity_id=power_entity_id,
            status="running",
            progress_phase="ensure_total",
            progress_label=f"Création du helper total… tentative {attempt}/{_REFERENCE_SYNC_ATTEMPTS}",
            attempt=attempt,
            attempts_total=_REFERENCE_SYNC_ATTEMPTS,
            will_retry=False,
            retry_scheduled=False,
            last_error=None,
            mapping=_energy_mapping_from_item(item),
            done=False,
            job_id=initial.get("job_id"),
        )
        await _save_catalogue_if_possible(hass)

        result = await _ensure_reference_energy_helpers(
            hass=hass,
            catalogue=catalogue,
            power_entity_id=power_entity_id,
        )
        mapping = result.get("mapping") or _energy_mapping_from_item(item)

        if result.get("ok"):
            status_payload = _set_reference_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="ready",
                progress_phase="ready",
                progress_label="Référence prête",
                attempt=attempt,
                attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=False,
                last_error=None,
                mapping=mapping,
                done=True,
                job_id=initial.get("job_id"),
            )
            await _save_catalogue_if_possible(hass)
            return {**result, **status_payload}

        error = result.get("error")
        if error == "total_not_ready" and attempt < _REFERENCE_SYNC_ATTEMPTS:
            _set_reference_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="running",
                progress_phase="retry_wait",
                progress_label=f"Helper total pas encore prêt, nouvelle tentative… ({attempt + 1}/{_REFERENCE_SYNC_ATTEMPTS})",
                attempt=attempt,
                attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                will_retry=True,
                retry_scheduled=False,
                last_error=error,
                mapping=mapping,
                done=False,
                job_id=initial.get("job_id"),
            )
            await _save_catalogue_if_possible(hass)
            await asyncio.sleep(_REFERENCE_SYNC_RETRY_DELAYS_S[attempt - 1])
            continue

        if error == "total_not_ready":
            status_payload = _set_reference_workflow_state(
                item=item,
                item_id=item_id,
                entity_id=power_entity_id,
                status="pending_background",
                progress_phase="pending_background",
                progress_label="Référence enregistrée, finalisation des helpers en arrière-plan…",
                attempt=attempt,
                attempts_total=_REFERENCE_SYNC_ATTEMPTS,
                will_retry=False,
                retry_scheduled=True,
                last_error=error,
                mapping=mapping,
                done=False,
                job_id=initial.get("job_id"),
            )
            await _save_catalogue_if_possible(hass)
            _schedule_reference_task(
                hass=hass,
                catalogue=catalogue,
                item_id=item_id,
                power_entity_id=power_entity_id,
                job_id=status_payload.get("job_id") or initial.get("job_id"),
            )
            return {**result, **status_payload}

        status_payload = _set_reference_workflow_state(
            item=item,
            item_id=item_id,
            entity_id=power_entity_id,
            status="failed",
            progress_phase="failed",
            progress_label="Référence enregistrée, mais la finalisation a échoué.",
            attempt=attempt,
            attempts_total=_REFERENCE_SYNC_ATTEMPTS,
            will_retry=False,
            retry_scheduled=False,
            last_error=error,
            mapping=mapping,
            done=True,
            job_id=initial.get("job_id"),
        )
        await _save_catalogue_if_possible(hass)
        return {**result, **status_payload}

    return None


def _reference_status_snapshot(catalogue: dict, entity_id: str | None):
    if entity_id:
        item_id, item = _find_catalogue_item_by_entity_id(catalogue, entity_id)
    else:
        item_id, item, entity_id = _find_current_reference_item(catalogue)

    if not item:
        if entity_id:
            return {
                "ok": False,
                "error": "entity:not_in_catalogue",
                "entity_id": entity_id,
            }
        return {
            "ok": True,
            "reference_entity_id": None,
            "reference_item_id": None,
            "reference_status": None,
        }

    workflow = ((_workflow_slot(item) if item.get("workflow") else None) or None)
    mapping = _energy_mapping_from_item(item)

    if not workflow or not workflow.get("status"):
        derived_status = (mapping or {}).get("status")
        workflow = {
            "status": "ready" if derived_status in ("ready", "partial") else "idle",
            "progress_phase": "ready" if derived_status in ("ready", "partial") else "idle",
            "progress_label": "Référence prête" if derived_status in ("ready", "partial") else "Aucun enrichissement en cours.",
            "attempt": _REFERENCE_SYNC_ATTEMPTS if derived_status in ("ready", "partial") else 0,
            "attempts_total": _REFERENCE_SYNC_ATTEMPTS,
            "will_retry": False,
            "retry_scheduled": False,
            "done": True,
            "last_error": None,
            "updated_at": utc_now_iso(),
        }

    return {
        "ok": True,
        "reference_entity_id": entity_id,
        "reference_item_id": item_id,
        "reference_status": _build_reference_status_payload(
            item_id=item_id,
            entity_id=entity_id,
            workflow=workflow,
            mapping=mapping,
        ),
    }


class CatalogueReferenceTotalView(HomeAssistantView):
    """Set or clear the \"reference total\" (main meter) item in the persistent catalogue."""

    url = f"{API_PREFIX}/catalogue/reference_total"
    name = "hse:unified:catalogue_reference_total"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})
        cat = domain_data.get("catalogue")
        if not cat:
            return self.json({"ok": False, "error": "catalogue:not_ready"}, status_code=503)

        body = await request.json() if request.can_read_body else {}
        entity_id = (body or {}).get("entity_id")
        if entity_id == "":
            entity_id = None

        items = _catalogue_items(cat)

        target_item_id = None
        target_item = None
        if entity_id is not None:
            target_item_id, target_item = _find_catalogue_item_by_entity_id(cat, entity_id)
            if not target_item_id:
                return self.json(
                    {"ok": False, "error": "entity:not_in_catalogue", "entity_id": entity_id},
                    status_code=404,
                )

        cleared = 0
        for item_id, item in (items.items() or []):
            if not isinstance(item, dict):
                continue
            enr = item.get("enrichment")
            if not isinstance(enr, dict):
                continue
            if enr.get("is_reference_total") is True and item_id != target_item_id:
                enr["is_reference_total"] = False
                cleared += 1
                src = item.get("source") or {}
                old_entity_id = src.get("entity_id")
                _cancel_reference_task(hass, old_entity_id)
                workflow = item.get("workflow")
                if isinstance(workflow, dict):
                    workflow.pop("reference_enrichment", None)

        enrich_reference = None
        reference_status = None
        if target_item is not None:
            enr = target_item.setdefault("enrichment", {})
            enr["is_reference_total"] = True
            enr["include"] = False
            enrich_reference = await _run_reference_enrichment_workflow(
                hass=hass,
                catalogue=cat,
                item_id=target_item_id,
                power_entity_id=entity_id,
            )
            reference_status = _reference_status_snapshot(cat, entity_id).get("reference_status")
        else:
            _cancel_reference_task(hass, entity_id)

        cat["generated_at"] = utc_now_iso()
        await _save_catalogue_if_possible(hass)

        return self.json(
            {
                "ok": True,
                "reference_entity_id": entity_id,
                "reference_item_id": target_item_id,
                "cleared_others": cleared,
                "enrich_reference": enrich_reference,
                "reference_status": reference_status,
                "status_url": _REFERENCE_TOTAL_STATUS_URL,
            }
        )


class CatalogueReferenceTotalStatusView(HomeAssistantView):
    """Expose current reference enrichment workflow status."""

    url = _REFERENCE_TOTAL_STATUS_URL
    name = "hse:unified:catalogue_reference_total_status"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})
        cat = domain_data.get("catalogue")
        if not cat:
            return self.json({"ok": False, "error": "catalogue:not_ready"}, status_code=503)

        entity_id = request.rel_url.query.get("entity_id")
        payload = _reference_status_snapshot(cat, entity_id)
        if not payload.get("ok"):
            return self.json(payload, status_code=404)
        return self.json(payload)
