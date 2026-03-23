"""Meta endpoints for rooms/types/assignments.

This is the backend source of truth for the UI Customisation pages.
"""

from __future__ import annotations

import re
from typing import Any

from homeassistant.components.http import HomeAssistantView

from ...const import API_PREFIX, DOMAIN
from ...meta_sync import _build_catalogue_entity_ids
from ...time_utils import utc_now_iso


# Accepte les entity_ids HA valides : domaine alphanumérique + underscore, point, puis nom avec tirets/chiffres
# Ex: sensor.my_sensor_01, sensor.freebox-power, input_boolean.test
_ENTITY_ID_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_\-]*$")

# Clés internes UI à ignorer silencieusement (jamais persistées)
_INTERNAL_KEYS = {"__none__", "__all__", "__unassigned__"}


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _rooms_iter(rooms_in: Any) -> list[dict[str, Any]]:
    """Accept rooms as list[{id,...}] OR dict[id -> {..}] and return a list."""
    if isinstance(rooms_in, list):
        return rooms_in
    if isinstance(rooms_in, dict):
        out: list[dict[str, Any]] = []
        for rid, v in rooms_in.items():
            if not isinstance(v, dict):
                raise ValueError("rooms:invalid")
            cur = dict(v)
            if "id" in cur and cur.get("id") != rid:
                raise ValueError("rooms.id:mismatch")
            cur.setdefault("id", rid)
            out.append(cur)
        return out
    return []


def _types_iter(types_in: Any) -> list[dict[str, Any]]:
    """Accept types as list[{id,...}] OR dict[id -> {..}] and return a list."""
    if isinstance(types_in, list):
        return types_in
    if isinstance(types_in, dict):
        out: list[dict[str, Any]] = []
        for tid, v in types_in.items():
            if not isinstance(v, dict):
                raise ValueError("types:invalid")
            cur = dict(v)
            if "id" in cur and cur.get("id") != tid:
                raise ValueError("types.id:mismatch")
            cur.setdefault("id", tid)
            out.append(cur)
        return out
    return []


def _validate_rooms(rooms_in: Any) -> list[dict[str, Any]]:
    rooms: list[dict[str, Any]] = []
    seen = set()
    for r in _rooms_iter(rooms_in):
        if not isinstance(r, dict):
            raise ValueError("rooms:invalid")
        rid = r.get("id")
        name = r.get("name")
        if not isinstance(rid, str) or not rid:
            raise ValueError("rooms.id:invalid")
        if rid in seen:
            raise ValueError("rooms.id:duplicate")
        seen.add(rid)
        if not isinstance(name, str) or not name:
            raise ValueError("rooms.name:invalid")

        out = {
            "id": rid,
            "name": name,
            "ha_area_id": r.get("ha_area_id") if isinstance(r.get("ha_area_id"), str) else None,
            "mode": r.get("mode") if r.get("mode") in ("auto", "manual", "mixed") else (r.get("mode") or "manual"),
            "name_mode": r.get("name_mode") if r.get("name_mode") in ("auto", "manual") else (r.get("name_mode") or "manual"),
        }
        rooms.append(out)
    return rooms


def _validate_types(types_in: Any) -> list[dict[str, Any]]:
    types: list[dict[str, Any]] = []
    seen = set()
    for t in _types_iter(types_in):
        if not isinstance(t, dict):
            raise ValueError("types:invalid")
        tid = t.get("id")
        name = t.get("name")
        if not isinstance(tid, str) or not tid:
            raise ValueError("types.id:invalid")
        if tid in seen:
            raise ValueError("types.id:duplicate")
        seen.add(tid)
        if not isinstance(name, str) or not name:
            raise ValueError("types.name:invalid")
        types.append({"id": tid, "name": name})
    return types


def _validate_assignments(assignments_in: Any) -> dict[str, Any]:
    a = _as_dict(assignments_in)
    out: dict[str, Any] = {}
    for eid, v in a.items():
        if not isinstance(eid, str):
            continue
        # Ignorer silencieusement les clés internes UI (__none__, etc.)
        if eid in _INTERNAL_KEYS:
            continue
        # Ignorer les entity_ids invalides sans crasher (robustesse)
        if not _ENTITY_ID_RE.match(eid):
            continue
        if v is None:
            continue
        if not isinstance(v, dict):
            raise ValueError("assignments.value:invalid")

        room_id = v.get("room_id")
        type_id = v.get("type_id")

        # Nettoyer les room_id internes UI qui auraient fuité dans le draft
        if isinstance(room_id, str) and (room_id in _INTERNAL_KEYS or room_id.startswith("__")):
            room_id = None

        out[eid] = {
            "room_id": room_id if isinstance(room_id, str) and room_id else None,
            "room_mode": v.get("room_mode") if v.get("room_mode") in ("auto", "manual") else (v.get("room_mode") or None),
            "type_id": type_id if isinstance(type_id, str) and type_id else None,
            "type_mode": v.get("type_mode") if v.get("type_mode") in ("auto", "manual") else (v.get("type_mode") or None),
            "tags": v.get("tags") if isinstance(v.get("tags"), list) else None,
        }

    return out


def _filter_assignments_by_catalogue(
    assignments: dict[str, Any],
    catalogue: dict[str, Any] | None,
) -> dict[str, Any]:
    """Retourne assignments filtré aux seuls entity_id présents dans le catalogue HSE.

    Si le catalogue est vide ou absent (première installation), on retourne assignments
    tel quel pour ne pas casser la compatibilité initiale.
    """
    catalogue_eids = _build_catalogue_entity_ids(catalogue)
    if not catalogue_eids:
        return assignments
    return {eid: v for eid, v in assignments.items() if eid in catalogue_eids}


class MetaView(HomeAssistantView):
    url = f"{API_PREFIX}/meta"
    name = "hse:unified:meta"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})

        meta_store = domain_data.get("meta")
        if not meta_store:
            meta_store = {"schema_version": 1, "generated_at": None, "meta": {"rooms": [], "types": [], "assignments": {}}, "sync": {}}

        # Filtrer les assignments zombies (sensors hors catalogue) avant de les exposer au frontend
        catalogue = domain_data.get("catalogue")
        meta = (meta_store.get("meta") or {})
        raw_assignments = meta.get("assignments") or {}
        filtered_assignments = _filter_assignments_by_catalogue(raw_assignments, catalogue)

        # Retourner une vue filtrée sans modifier le store en mémoire
        import copy
        meta_store_out = copy.deepcopy(meta_store)
        if isinstance(meta_store_out.get("meta"), dict):
            meta_store_out["meta"]["assignments"] = filtered_assignments

        return self.json({"ok": True, "meta_store": meta_store_out})

    async def post(self, request):
        hass = request.app["hass"]
        domain_data = hass.data.get(DOMAIN, {})

        meta_store = domain_data.get("meta")
        if not isinstance(meta_store, dict):
            return self.json({"ok": False, "error": "meta:not_ready"}, status_code=503)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        meta_in = body.get("meta") if isinstance(body, dict) and "meta" in body else body
        if not isinstance(meta_in, dict):
            return self.json({"ok": False, "error": "meta:invalid"}, status_code=400)

        try:
            rooms = _validate_rooms(meta_in.get("rooms"))
            types = _validate_types(meta_in.get("types"))
            assignments = _validate_assignments(meta_in.get("assignments"))

            # Filtrer les assignments zombies avant persistance
            catalogue = domain_data.get("catalogue")
            assignments = _filter_assignments_by_catalogue(assignments, catalogue)

            rules = meta_in.get("rules")
            if rules is None:
                rules = meta_store.get("meta", {}).get("rules")
            if rules is None:
                rules = {"room_from_ha_area": True, "type_rules": []}
            if not isinstance(rules, dict):
                raise ValueError("rules:invalid")

            out = {
                "rooms": rooms,
                "types": types,
                "assignments": assignments,
                "rules": rules,
                "updated_at": utc_now_iso(),
            }

        except ValueError as e:
            return self.json({"ok": False, "error": str(e)}, status_code=400)

        meta_store["meta"] = out
        meta_store["generated_at"] = utc_now_iso()

        saver = domain_data.get("meta_save")
        if saver:
            await saver()

        return self.json({"ok": True, "meta_store": meta_store})
