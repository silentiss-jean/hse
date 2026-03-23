from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er

from ...const import API_PREFIX, DOMAIN
from ...scan_engine import detect_kind, status_from_registry


def _q_bool(request, key: str, default: bool) -> bool:
    raw = request.query.get(key)
    if raw is None:
        return default
    raw = str(raw).strip().lower()
    return raw in ("1", "true", "yes", "y", "on")


def _dedup_group_key(c: dict) -> str | None:
    device_id = c.get("device_id")
    if not device_id:
        return None
    return f"{device_id}|{c.get('kind') or ''}|{c.get('device_class') or ''}|{c.get('state_class') or ''}"


def _score_candidate(c: dict) -> int:
    s = 0

    status = str(c.get("status") or "").lower()
    if status == "ok":
        s += 30
    elif status:
        s -= 80

    ha_state = str(c.get("ha_state") or "").lower()
    if ha_state in ("unknown", "unavailable"):
        s -= 60

    if c.get("ha_restored"):
        s -= 10

    if c.get("device_id"):
        s += 10
    if c.get("unique_id"):
        s += 2

    if c.get("state_class") == "measurement":
        s += 2

    integ = str(c.get("integration_domain") or "").lower()
    if integ == "tplink":
        s += 2
    elif integ == "tapo":
        s += 1

    return s


def _is_eligible_for_cost_calc(c: dict) -> tuple[bool, str | None]:
    # Conservative eligibility: we only auto-select sensors that are currently usable.
    status = str(c.get("status") or "").lower()
    if status and status != "ok":
        return False, f"status:{status}"

    ha_state = str(c.get("ha_state") or "").lower()
    if ha_state in ("unknown", "unavailable"):
        return False, f"ha_state:{ha_state}"

    if c.get("disabled_by") is not None:
        return False, "disabled"

    # restored is allowed but penalized in score
    return True, None


class EntitiesScanView(HomeAssistantView):
    url = f"{API_PREFIX}/entities/scan"
    name = "hse:unified:entities_scan"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]

        include_disabled = _q_bool(request, "include_disabled", False)
        exclude_hse = _q_bool(request, "exclude_hse", True)

        ent_reg = er.async_get(hass)
        reg_by_entity_id = ent_reg.entities  # map entity_id -> registry entry

        candidates: list[dict] = []
        integration_counts: dict[str, dict[str, int]] = {}

        for st in hass.states.async_all():
            entity_id = st.entity_id
            domain = entity_id.split(".", 1)[0]
            if domain != "sensor":
                continue

            attrs = st.attributes or {}
            unit = attrs.get("unit_of_measurement")
            device_class = attrs.get("device_class")
            state_class = attrs.get("state_class")
            friendly_name = attrs.get("friendly_name") or entity_id

            kind = detect_kind(device_class, unit)
            if kind is None:
                continue

            reg_entry = reg_by_entity_id.get(entity_id)
            platform = reg_entry.platform if reg_entry else None
            disabled_by = reg_entry.disabled_by if reg_entry else None

            ha_state = st.state
            ha_restored = bool(attrs.get("restored", False))

            status, status_reason = status_from_registry(reg_entry, ha_state=ha_state, ha_restored=ha_restored)

            if not include_disabled and disabled_by is not None:
                continue

            is_hse = (platform == DOMAIN) or entity_id.startswith("sensor.hse_")
            if exclude_hse and is_hse:
                continue

            disabled_by_value = None
            if disabled_by is not None:
                disabled_by_value = getattr(disabled_by, "value", str(disabled_by))

            integration_domain = platform or "unknown"

            candidates.append(
                {
                    "entity_id": entity_id,
                    "kind": kind,
                    "unit": unit,
                    "device_class": device_class,
                    "state_class": state_class,
                    "integration_domain": integration_domain,
                    "platform": platform,
                    "config_entry_id": reg_entry.config_entry_id if reg_entry else None,
                    "device_id": reg_entry.device_id if reg_entry else None,
                    "area_id": reg_entry.area_id if reg_entry else None,
                    "name": friendly_name,
                    "unique_id": reg_entry.unique_id if reg_entry else None,
                    "disabled_by": disabled_by_value,
                    "status": status,
                    "status_reason": status_reason,
                    "ha_state": ha_state,
                    "ha_restored": ha_restored,
                    "source": {"is_hse": is_hse},
                }
            )

            integration_counts.setdefault(integration_domain, {"power": 0, "energy": 0})
            integration_counts[integration_domain][kind] += 1

        # Dedup metadata (computed, no side effects)
        groups: dict[str, list[dict]] = {}
        for c in candidates:
            gk = _dedup_group_key(c)
            if not gk:
                continue
            groups.setdefault(gk, []).append(c)

        group_best: dict[str, str] = {}
        group_size: dict[str, int] = {}

        for gk, items in groups.items():
            group_size[gk] = len(items)

            # choose best, by score then tplink tie-break
            best = items[0]
            for cand in items[1:]:
                sa = _score_candidate(best)
                sb = _score_candidate(cand)
                if sb > sa:
                    best = cand
                elif sb == sa:
                    ia = str(best.get("integration_domain") or "").lower()
                    ib = str(cand.get("integration_domain") or "").lower()
                    if ib == "tplink" and ia != "tplink":
                        best = cand

            group_best[gk] = str(best.get("entity_id"))

        for c in candidates:
            gk = _dedup_group_key(c)
            score = _score_candidate(c)
            eligible, eligible_reason = _is_eligible_for_cost_calc(c)

            c["dedup_group_key"] = gk
            c["dedup_group_size"] = group_size.get(gk, 1) if gk else 1
            c["dedup_best_entity_id"] = group_best.get(gk) if gk else None
            c["dedup_is_best"] = bool(gk and group_best.get(gk) == c.get("entity_id"))
            c["dedup_score"] = score
            c["eligible_for_cost_calc"] = eligible
            c["eligible_reason"] = eligible_reason

        # Suggested selection for cost calc (power only, groups where we can dedup)
        suggested: list[str] = []
        skipped_no_device_id = 0
        considered_groups = 0

        for gk, items in groups.items():
            # group key already includes kind, so we can safely filter on first item
            if str(items[0].get("kind")) != "power":
                continue

            considered_groups += 1

            eligible_items = []
            for it in items:
                ok, _ = _is_eligible_for_cost_calc(it)
                if ok:
                    eligible_items.append(it)

            if not eligible_items:
                continue

            best_e = eligible_items[0]
            for cand in eligible_items[1:]:
                sa = _score_candidate(best_e)
                sb = _score_candidate(cand)
                if sb > sa:
                    best_e = cand
                elif sb == sa:
                    ia = str(best_e.get("integration_domain") or "").lower()
                    ib = str(cand.get("integration_domain") or "").lower()
                    if ib == "tplink" and ia != "tplink":
                        best_e = cand

            suggested.append(str(best_e.get("entity_id")))

        # Don't suggest candidates without device_id (can't dedup safely)
        for c in candidates:
            if c.get("kind") != "power":
                continue
            if c.get("device_id"):
                continue
            skipped_no_device_id += 1

        suggested = sorted(set(suggested))

        integrations = [
            {
                "integration_domain": integ,
                "power_count": counts["power"],
                "energy_count": counts["energy"],
                "total": counts["power"] + counts["energy"],
            }
            for integ, counts in integration_counts.items()
        ]
        integrations.sort(key=lambda x: x["total"], reverse=True)

        return self.json(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "rules": {
                    "include_disabled": include_disabled,
                    "exclude_hse": exclude_hse,
                },
                "integrations": integrations,
                "candidates": candidates,
                "suggested_cost_entity_ids": suggested,
                "suggested_summary": {
                    "considered_groups": considered_groups,
                    "suggested_count": len(suggested),
                    "skipped_power_no_device_id": skipped_no_device_id,
                },
            }
        )
