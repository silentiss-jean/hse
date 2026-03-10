from __future__ import annotations

import re
from typing import Any

from homeassistant.core import HomeAssistant


_ENTITY_ID_RE = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


def _safe_id(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9_]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def room_id_for_area(area_id: str) -> str:
    return "ha_" + _safe_id(area_id)


async def async_build_ha_snapshot(hass: HomeAssistant) -> dict[str, Any]:
    from homeassistant.helpers import area_registry as ar
    from homeassistant.helpers import entity_registry as er

    ent_reg = er.async_get(hass)
    area_reg = ar.async_get(hass)

    area_name_by_id: dict[str, str] = {}
    for a in area_reg.async_list_areas():
        if a and a.id:
            area_name_by_id[a.id] = a.name or a.id

    entities: dict[str, Any] = {}
    for e in ent_reg.entities.values():
        eid = getattr(e, "entity_id", None)
        if not isinstance(eid, str) or not eid:
            continue
        if not eid.startswith("sensor."):
            continue

        entities[eid] = {
            "entity_id": eid,
            "device_id": getattr(e, "device_id", None),
            "area_id": getattr(e, "area_id", None),
            "area_name": area_name_by_id.get(getattr(e, "area_id", None) or ""),
            "platform": getattr(e, "platform", None),
            "config_entry_id": getattr(e, "config_entry_id", None),
            "unique_id": getattr(e, "unique_id", None),
            "name": getattr(e, "name", None),
            "original_name": getattr(e, "original_name", None),
        }

    return {
        "areas": [{"area_id": aid, "name": nm} for aid, nm in area_name_by_id.items()],
        "entities": entities,
    }


def compute_pending_diff(meta_store: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    meta = (meta_store or {}).get("meta") or {}

    rooms = meta.get("rooms") if isinstance(meta, dict) else []
    rooms = rooms if isinstance(rooms, list) else []

    area_name_by_id: dict[str, str] = {}
    for a in snapshot.get("areas") or []:
        if isinstance(a, dict) and isinstance(a.get("area_id"), str):
            area_name_by_id[a["area_id"]] = str(a.get("name") or a["area_id"])

    room_by_area: dict[str, dict[str, Any]] = {}
    for r in rooms:
        if not isinstance(r, dict):
            continue
        ha_area_id = r.get("ha_area_id")
        if isinstance(ha_area_id, str) and ha_area_id:
            room_by_area[ha_area_id] = r

    create_rooms: list[dict[str, Any]] = []
    rename_rooms: list[dict[str, Any]] = []

    for area_id, area_name in area_name_by_id.items():
        if area_id not in room_by_area:
            create_rooms.append(
                {
                    "room_id": room_id_for_area(area_id),
                    "name": area_name,
                    "ha_area_id": area_id,
                }
            )
        else:
            r = room_by_area[area_id]
            cur_name = r.get("name")
            if isinstance(cur_name, str) and cur_name and cur_name != area_name:
                name_mode = r.get("name_mode")
                eligible = (name_mode is None) or (name_mode != "manual")
                rename_rooms.append(
                    {
                        "room_id": r.get("id"),
                        "ha_area_id": area_id,
                        "from": cur_name,
                        "to": area_name,
                        "eligible": eligible,
                    }
                )

    assignments = meta.get("assignments") if isinstance(meta, dict) else {}
    assignments = assignments if isinstance(assignments, dict) else {}

    suggest_room: list[dict[str, Any]] = []
    entities = snapshot.get("entities") if isinstance(snapshot, dict) else {}
    entities = entities if isinstance(entities, dict) else {}

    for eid, e in entities.items():
        if not isinstance(eid, str) or not _ENTITY_ID_RE.match(eid):
            continue
        if not isinstance(e, dict):
            continue
        area_id = e.get("area_id")
        if not isinstance(area_id, str) or not area_id:
            continue

        target_room_id = None
        if area_id in room_by_area:
            target_room_id = room_by_area[area_id].get("id")
        else:
            target_room_id = room_id_for_area(area_id)

        cur = assignments.get(eid)
        if cur is None:
            cur = {}
        if not isinstance(cur, dict):
            continue

        room_mode = cur.get("room_mode")
        if room_mode == "manual":
            continue

        cur_room_id = cur.get("room_id")
        if cur_room_id == target_room_id:
            continue

        suggest_room.append(
            {
                "entity_id": eid,
                "from_room_id": cur_room_id,
                "to_room_id": target_room_id,
                "reason": "ha_area",
            }
        )

    has_changes = bool(create_rooms or rename_rooms or suggest_room)

    return {
        "has_changes": has_changes,
        "rooms": {"create": create_rooms, "rename": rename_rooms},
        "assignments": {"suggest_room": suggest_room},
        "stats": {
            "create_rooms": len(create_rooms),
            "rename_rooms": len(rename_rooms),
            "suggest_room": len(suggest_room),
        },
    }


def apply_pending_diff(meta_store: dict[str, Any], diff: dict[str, Any], *, apply_mode: str = "auto") -> dict[str, Any]:
    if apply_mode not in ("auto", "all"):
        apply_mode = "auto"

    meta = (meta_store or {}).get("meta")
    if not isinstance(meta, dict):
        return meta_store

    rooms = meta.get("rooms")
    if not isinstance(rooms, list):
        rooms = []
        meta["rooms"] = rooms

    room_by_id: dict[str, dict[str, Any]] = {}
    for r in rooms:
        if isinstance(r, dict) and isinstance(r.get("id"), str):
            room_by_id[r["id"]] = r

    create_rooms = ((diff or {}).get("rooms") or {}).get("create") or []
    for it in create_rooms:
        if not isinstance(it, dict):
            continue
        rid = it.get("room_id")
        nm = it.get("name")
        aid = it.get("ha_area_id")
        if not isinstance(rid, str) or not rid:
            continue
        if rid in room_by_id:
            continue
        if not isinstance(nm, str) or not nm:
            nm = rid
        room_obj = {
            "id": rid,
            "name": nm,
            "ha_area_id": aid if isinstance(aid, str) and aid else None,
            "mode": "auto",
            "name_mode": "auto",
        }
        rooms.append(room_obj)
        room_by_id[rid] = room_obj

    rename_rooms = ((diff or {}).get("rooms") or {}).get("rename") or []
    for it in rename_rooms:
        if not isinstance(it, dict):
            continue
        rid = it.get("room_id")
        to = it.get("to")
        eligible = it.get("eligible") is True
        if apply_mode == "auto" and not eligible:
            continue
        if not isinstance(rid, str) or not rid:
            continue
        if not isinstance(to, str) or not to:
            continue
        r = room_by_id.get(rid)
        if not r:
            continue
        r["name"] = to

    assignments = meta.get("assignments")
    if not isinstance(assignments, dict):
        assignments = {}
        meta["assignments"] = assignments

    suggest_room = ((diff or {}).get("assignments") or {}).get("suggest_room") or []
    for it in suggest_room:
        if not isinstance(it, dict):
            continue
        eid = it.get("entity_id")
        to_room_id = it.get("to_room_id")
        if not isinstance(eid, str) or not _ENTITY_ID_RE.match(eid):
            continue
        if not isinstance(to_room_id, str) or not to_room_id:
            continue

        cur = assignments.get(eid)
        if cur is None:
            cur = {}
            assignments[eid] = cur
        if not isinstance(cur, dict):
            continue

        room_mode = cur.get("room_mode")
        if apply_mode == "auto" and room_mode == "manual":
            continue

        cur["room_id"] = to_room_id
        if cur.get("room_mode") is None:
            cur["room_mode"] = "auto"

    return meta_store
