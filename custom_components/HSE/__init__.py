from __future__ import annotations

from datetime import timedelta
from pathlib import Path

from homeassistant.components.frontend import async_register_built_in_panel, async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_track_time_interval

from .api.unified_api import async_register_unified_api
from .catalogue_manager import merge_scan_into_catalogue
from .catalogue_store import async_load_catalogue, async_save_catalogue
from .const import (
    DOMAIN,
    STATIC_URL,
    PANEL_URL_PATH,
    PANEL_TITLE,
    PANEL_ICON,
    PANEL_ELEMENT_NAME,
    PANEL_JS_URL,
    CATALOGUE_REFRESH_INTERVAL_S,
    CATALOGUE_OFFLINE_GRACE_S,
    META_SYNC_INTERVAL_S,
)
from .meta_store import async_load_meta, async_save_meta
from .meta_sync import async_build_ha_snapshot, compute_pending_diff
from .repairs import async_sync_repairs
from .scan_engine import detect_kind, status_from_registry, utc_now_iso


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    async_register_unified_api(hass)

    static_dir = Path(__file__).parent / "web_static"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(STATIC_URL, str(static_dir), False)]
    )

    async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_URL_PATH,
        require_admin=True,
        config={
            "_panel_custom": {
                "name": PANEL_ELEMENT_NAME,
                "js_url": PANEL_JS_URL,
            }
        },
    )

    domain_data = hass.data.setdefault(DOMAIN, {})

    domain_data["catalogue"] = await async_load_catalogue(hass)

    async def _save_catalogue():
        await async_save_catalogue(hass, domain_data["catalogue"])

    domain_data["catalogue_save"] = _save_catalogue

    # Meta (rooms/types/assignments)
    domain_data["meta"] = await async_load_meta(hass)

    async def _save_meta():
        await async_save_meta(hass, domain_data["meta"])

    domain_data["meta_save"] = _save_meta

    async def _meta_sync_tick(*, force: bool = False, persist: bool = True):
        if domain_data.get("meta_sync_running") and not force:
            return {"skipped": True, "reason": "sync_running"}

        domain_data["meta_sync_running"] = True
        try:
            # Passer le catalogue pour filtrer snapshot.entities sur les capteurs HSE uniquement
            snap = await async_build_ha_snapshot(hass, catalogue=domain_data.get("catalogue"))
            diff = compute_pending_diff(domain_data["meta"], snap)

            sync = domain_data["meta"].setdefault("sync", {})
            sync["snapshot"] = snap
            sync["pending_diff"] = diff if diff.get("has_changes") else None
            sync["pending_generated_at"] = utc_now_iso() if diff.get("has_changes") else None
            sync["last_run"] = utc_now_iso()
            sync["last_error"] = None

            domain_data["meta"]["generated_at"] = utc_now_iso()

            if persist:
                await async_save_meta(hass, domain_data["meta"])

            return {"ok": True, "has_changes": bool(diff.get("has_changes")), "stats": diff.get("stats")}
        except Exception as err:  # noqa: BLE001
            sync = domain_data["meta"].setdefault("sync", {})
            sync["last_error"] = str(err)
            sync["last_run"] = utc_now_iso()
            if persist:
                await async_save_meta(hass, domain_data["meta"])
            return {"ok": False, "error": str(err)}
        finally:
            domain_data["meta_sync_running"] = False

    domain_data["meta_sync_tick"] = _meta_sync_tick

    async def _do_refresh(*, force: bool = False):
        if domain_data.get("catalogue_refresh_running") and not force:
            return {"skipped": True, "reason": "refresh_running"}

        domain_data["catalogue_refresh_running"] = True
        try:
            from homeassistant.helpers import entity_registry as er

            ent_reg = er.async_get(hass)
            reg_by_entity_id = ent_reg.entities

            now_iso = utc_now_iso()
            candidates = []
            integration_counts = {}

            for st in hass.states.async_all():
                entity_id = st.entity_id
                if not entity_id.startswith("sensor."):
                    continue

                attrs = st.attributes or {}
                unit = attrs.get("unit_of_measurement")
                device_class = attrs.get("device_class")
                state_class = attrs.get("state_class")

                kind = detect_kind(device_class, unit)
                if kind is None:
                    continue

                reg_entry = reg_by_entity_id.get(entity_id)
                platform = reg_entry.platform if reg_entry else None

                is_hse = (platform == DOMAIN) or entity_id.startswith("sensor.hse_")
                if is_hse:
                    continue

                ha_state = st.state
                ha_restored = bool(attrs.get("restored", False))

                status, status_reason = status_from_registry(reg_entry, ha_state=ha_state, ha_restored=ha_restored)

                disabled_by = reg_entry.disabled_by if reg_entry else None
                disabled_by_value = None
                if disabled_by is not None:
                    disabled_by_value = getattr(disabled_by, "value", str(disabled_by))

                integration_domain = platform or "unknown"

                ha_state_l = str(ha_state or "").lower()
                is_unavailable = ha_state_l in ("unavailable", "unknown")

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
                        "name": (attrs.get("friendly_name") or entity_id),
                        "unique_id": reg_entry.unique_id if reg_entry else None,
                        "disabled_by": disabled_by_value,
                        "status": status,
                        "status_reason": status_reason,
                        "ha_state": ha_state,
                        "ha_restored": ha_restored,
                        "meta": {
                            "offline_grace_s": CATALOGUE_OFFLINE_GRACE_S,
                            "scan_generated_at": now_iso,
                            "is_unavailable": is_unavailable,
                        },
                    }
                )

                integration_counts.setdefault(integration_domain, {"power": 0, "energy": 0})
                integration_counts[integration_domain][kind] += 1

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

            scan_payload = {
                "integrations": integrations,
                "candidates": candidates,
            }

            domain_data["catalogue"] = merge_scan_into_catalogue(
                domain_data["catalogue"],
                scan_payload,
                offline_grace_s=CATALOGUE_OFFLINE_GRACE_S,
            )
            await async_save_catalogue(hass, domain_data["catalogue"])

            # Sync repairs issues after each refresh.
            await async_sync_repairs(hass)

            return {"ok": True, "candidates": len(candidates), "integrations": len(integrations)}
        finally:
            domain_data["catalogue_refresh_running"] = False

    domain_data["catalogue_refresh"] = _do_refresh

    hass.async_create_task(_do_refresh(force=True))
    hass.async_create_task(_meta_sync_tick(force=True, persist=True))

    async def _interval(_now):
        await _do_refresh(force=False)

    domain_data["catalogue_unsub_interval"] = async_track_time_interval(
        hass,
        _interval,
        timedelta(seconds=CATALOGUE_REFRESH_INTERVAL_S),
    )

    async def _meta_interval(_now):
        await _meta_sync_tick(force=False, persist=True)

    domain_data["meta_unsub_interval"] = async_track_time_interval(
        hass,
        _meta_interval,
        timedelta(seconds=META_SYNC_INTERVAL_S),
    )

    domain_data[entry.entry_id] = {}
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    async_remove_panel(hass, PANEL_URL_PATH)

    domain_data = hass.data.get(DOMAIN, {})
    unsub = domain_data.pop("catalogue_unsub_interval", None)
    if unsub:
        unsub()

    unsub_meta = domain_data.pop("meta_unsub_interval", None)
    if unsub_meta:
        unsub_meta()

    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return True
