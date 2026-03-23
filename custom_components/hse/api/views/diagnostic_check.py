from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er

from ...const import API_PREFIX, DOMAIN


HISTORICAL_POLICIES = {"removed", "archived"}


def _admin_only(request) -> bool:
    user = request.get("hass_user")
    return bool(user and getattr(user, "is_admin", False))


def _norm_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [x for x in value if isinstance(x, str) and x]


def _triage_policy(row: dict | None) -> str:
    triage = (row or {}).get("triage") or {}
    return str(triage.get("policy") or "normal").strip().lower() or "normal"


def _is_historical_row(row: dict | None) -> bool:
    return _triage_policy(row) in HISTORICAL_POLICIES


def _operational_rows(rows: list[dict]) -> list[dict]:
    return [row for row in rows if not _is_historical_row(row)]


def _iter_catalogue_items_for_entity(catalogue: dict | None, entity_id: str) -> list[dict]:
    items = (catalogue or {}).get("items") or {}
    out: list[dict] = []
    if not isinstance(items, dict):
        return out

    for item_id, item in items.items():
        if not isinstance(item, dict):
            continue
        source = item.get("source") or {}
        if not isinstance(source, dict):
            continue
        if source.get("entity_id") != entity_id:
            continue

        out.append(
            {
                "item_id": item_id,
                "source": source,
                "health": item.get("health") or {},
                "triage": item.get("triage") or {},
                "enrichment": item.get("enrichment") or {},
                "workflow": item.get("workflow"),
            }
        )

    return out


def _active_entry_from_row(hass, row: dict) -> dict | None:
    src = row.get("source") or {}
    entry_id = src.get("config_entry_id")
    domain = src.get("platform") or src.get("integration_domain")
    if not entry_id or not domain:
        return None

    try:
        entries = hass.config_entries.async_entries(domain)
    except Exception:  # noqa: BLE001
        entries = []

    for e in entries or []:
        if e.entry_id != entry_id:
            continue
        return {
            "entry_id": e.entry_id,
            "domain": domain,
            "title": e.title,
            "state": str(getattr(e, "state", None) or ""),
            "source": getattr(e, "source", None),
        }

    return None


def _find_active_config_entries(hass, rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()

    for row in rows:
        found = _active_entry_from_row(hass, row)
        if not found:
            continue
        key = f"{found['domain']}:{found['entry_id']}"
        if key in seen:
            continue
        seen.add(key)
        out.append(found)

    return out


def _pick_current_item(rows: list[dict], active_entries: list[dict]) -> tuple[dict | None, str]:
    if not rows:
        return None, "no_item"

    active_ids = {x.get("entry_id") for x in active_entries if x.get("entry_id")}

    def sort_key(row: dict):
        src = row.get("source") or {}
        entry_id = src.get("config_entry_id")
        last_seen_at = str(src.get("last_seen_at") or "")
        is_historical = _is_historical_row(row)
        has_active_entry = entry_id in active_ids
        return (
            1 if has_active_entry else 0,
            0 if is_historical else 1,
            last_seen_at,
            str(row.get("item_id") or ""),
        )

    rows_sorted = sorted(rows, key=sort_key, reverse=True)
    current = rows_sorted[0]
    current_entry_id = (current.get("source") or {}).get("config_entry_id")

    if current_entry_id in active_ids:
        return current, "latest_last_seen_at_and_active_config_entry"
    if not _is_historical_row(current):
        return current, "latest_last_seen_at_operational"
    return current, "latest_last_seen_at_historical"


def _reason_code_for_entity(
    *,
    rows: list[dict],
    operational_rows: list[dict],
    active_entries: list[dict],
    state_exists: bool,
    state_value: str | None,
) -> tuple[str, str, str]:
    if not rows:
        return (
            "entity_missing_but_catalogue_absent",
            "ok",
            "Aucun item catalogue trouvé pour cette entité.",
        )

    if len(operational_rows) > 1 and len(active_entries) == 1:
        return (
            "historical_catalogue_duplicates",
            "warning",
            "Plusieurs lignes catalogue opérationnelles partagent le même source.entity_id, mais une seule config entry active semble encore exister.",
        )

    if len(operational_rows) > 1 and len(active_entries) > 1:
        return (
            "multiple_live_helpers",
            "error",
            "Plusieurs lignes catalogue opérationnelles et plusieurs config entries actives semblent coexister pour la même entité logique.",
        )

    if len(operational_rows) == 1 and not state_exists:
        return (
            "entity_missing_but_catalogue_present",
            "warning",
            "Le catalogue contient un item opérationnel, mais l'entité n'est plus visible dans Home Assistant.",
        )

    if state_exists and str(state_value or "").lower() in ("unknown", "unavailable"):
        return (
            "entity_unavailable",
            "warning",
            "L'entité existe mais son état courant est unknown/unavailable.",
        )

    return (
        "no_issue",
        "ok",
        "Aucune incohérence évidente détectée; les lignes removed/archived sont traitées comme de l'historique.",
    )


class DiagnosticCheckView(HomeAssistantView):
    url = f"{API_PREFIX}/diagnostic/check"
    name = "hse:unified:diagnostic_check"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]

        if not _admin_only(request):
            return self.json({"error": "admin_required"}, status_code=403)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        entity_ids = _norm_list(body.get("entity_ids"))
        checks = _norm_list(body.get("checks"))
        include_history = bool(body.get("include_history", True))

        if not checks:
            checks = [
                "catalogue_duplicates",
                "config_entry_consistency",
                "entity_presence",
                "helper_consistency",
            ]

        catalogue = hass.data.get(DOMAIN, {}).get("catalogue") or {}
        items = catalogue.get("items") if isinstance(catalogue, dict) else {}
        if not entity_ids:
            entity_ids = sorted(
                {
                    (it.get("source") or {}).get("entity_id")
                    for it in (items or {}).values()
                    if isinstance(it, dict) and (it.get("source") or {}).get("entity_id")
                }
            )

        ent_reg = er.async_get(hass)

        results: list[dict] = []
        warning_count = 0
        error_count = 0
        found_reason_codes: set[str] = set()

        for entity_id in entity_ids:
            state_obj = hass.states.get(entity_id)
            state_exists = bool(state_obj or ent_reg.async_get(entity_id))
            state_value = state_obj.state if state_obj else None

            rows = _iter_catalogue_items_for_entity(catalogue, entity_id)
            operational_rows = _operational_rows(rows)
            active_entries = _find_active_config_entries(hass, operational_rows)
            current_item, selection_reason = _pick_current_item(rows, active_entries)

            reason_code, status, explanation = _reason_code_for_entity(
                rows=rows,
                operational_rows=operational_rows,
                active_entries=active_entries,
                state_exists=state_exists,
                state_value=state_value,
            )

            if status == "warning":
                warning_count += 1
            elif status == "error":
                error_count += 1

            if reason_code != "no_issue":
                found_reason_codes.add(reason_code)

            historical_rows = [row for row in rows if _is_historical_row(row)]
            archived_items = sum(1 for row in rows if _triage_policy(row) == "archived")
            removed_items = sum(1 for row in rows if _triage_policy(row) == "removed")
            operational_count = len(operational_rows)

            current_id = current_item.get("item_id") if current_item else None
            archivable_item_ids = [
                row.get("item_id")
                for row in operational_rows
                if row.get("item_id") and row.get("item_id") != current_id
            ]

            historical_items = []
            if include_history and current_item is not None:
                for row in rows:
                    if row.get("item_id") == current_id:
                        continue
                    triage_policy = _triage_policy(row)
                    historical_items.append(
                        {
                            "item_id": row.get("item_id"),
                            "unique_id": (row.get("source") or {}).get("unique_id"),
                            "config_entry_id": (row.get("source") or {}).get("config_entry_id"),
                            "last_seen_at": (row.get("source") or {}).get("last_seen_at"),
                            "triage_policy": triage_policy,
                            "escalation": (row.get("health") or {}).get("escalation"),
                            "state": triage_policy if triage_policy in HISTORICAL_POLICIES else "historical",
                        }
                    )

            device_ids = {
                (row.get("source") or {}).get("device_id")
                for row in rows
                if (row.get("source") or {}).get("device_id")
            }
            platforms = {
                (row.get("source") or {}).get("platform")
                for row in rows
                if (row.get("source") or {}).get("platform")
            }
            integration_domains = {
                (row.get("source") or {}).get("integration_domain")
                for row in rows
                if (row.get("source") or {}).get("integration_domain")
            }

            result = {
                "entity_id": entity_id,
                "status": status,
                "reason_code": reason_code,
                "explanation": explanation,
                "counts": {
                    "catalogue_items_for_entity": len(rows),
                    "active_config_entries": len(active_entries),
                    "operational_items": operational_count,
                    "historical_items": len(historical_rows),
                    "removed_items": removed_items,
                    "archived_items": archived_items,
                    "normal_items": operational_count,
                },
                "entity_presence": {
                    "state_exists": state_exists,
                    "state_value": state_value,
                    "registry_exists": bool(ent_reg.async_get(entity_id)),
                },
                "current_item": None,
                "historical_items": historical_items,
                "active_config_entries": active_entries,
                "evidence": {
                    "same_entity_id": len(rows) > 0,
                    "same_device_id": len(device_ids) == 1 if device_ids else False,
                    "device_ids": sorted(device_ids),
                    "platforms": sorted(platforms),
                    "integration_domains": sorted(integration_domains),
                },
                "next_step": {
                    "kind": "explain_only",
                    "safe_to_auto_fix": reason_code == "historical_catalogue_duplicates" and bool(archivable_item_ids),
                    "recommended_action": (
                        "consolidate_catalogue_history"
                        if reason_code == "historical_catalogue_duplicates" and archivable_item_ids
                        else None
                    ),
                    "archive_item_ids": archivable_item_ids,
                },
            }

            if current_item is not None:
                src = current_item.get("source") or {}
                health = current_item.get("health") or {}
                triage = current_item.get("triage") or {}
                result["current_item"] = {
                    "item_id": current_item.get("item_id"),
                    "unique_id": src.get("unique_id"),
                    "config_entry_id": src.get("config_entry_id"),
                    "last_seen_at": src.get("last_seen_at"),
                    "last_seen_state": src.get("last_seen_state"),
                    "triage_policy": triage.get("policy"),
                    "escalation": health.get("escalation"),
                    "selection_reason": selection_reason,
                }

            results.append(result)

        return self.json(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "input": {
                    "entity_ids": entity_ids,
                    "checks": checks,
                    "include_history": include_history,
                },
                "summary": {
                    "checked_count": len(entity_ids),
                    "issues_found": len([r for r in results if r["reason_code"] != "no_issue"]),
                    "warning_count": warning_count,
                    "error_count": error_count,
                    "reason_codes": sorted(found_reason_codes),
                },
                "results": results,
            }
        )
