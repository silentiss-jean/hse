from __future__ import annotations

from datetime import datetime, timezone

from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers import entity_registry as er

from ...const import API_PREFIX, DOMAIN
from .enrich_preview import derive_base_slug


def _admin_only(request) -> bool:
    user = request.get("hass_user")
    return bool(user and getattr(user, "is_admin", False))


def _find_config_entries_by_name(hass, *, domain: str, name: str):
    try:
        entries = hass.config_entries.async_entries(domain)
    except Exception:  # noqa: BLE001
        return []

    out = []
    for e in entries or []:
        try:
            if (e.title or "") == name:
                out.append(e)
                continue
            opts = getattr(e, "options", None) or {}
            if isinstance(opts, dict) and opts.get("name") == name:
                out.append(e)
        except Exception:  # noqa: BLE001
            continue

    return out


class EnrichCleanupView(HomeAssistantView):
    url = f"{API_PREFIX}/enrich/cleanup"
    name = "hse:unified:enrich_cleanup"
    requires_auth = True

    async def post(self, request):
        hass = request.app["hass"]

        if not _admin_only(request):
            return self.json({"error": "admin_required"}, status_code=403)

        body = await request.json() if request.can_read_body else {}
        body = body or {}

        dry_run = body.get("dry_run", True)
        stale_only = body.get("stale_only", True)
        types = body.get("types")
        if not isinstance(types, list) or not types:
            types = ["integration", "utility_meter"]

        entity_ids = body.get("entity_ids")
        if not isinstance(entity_ids, list) or not entity_ids:
            cat = hass.data.get(DOMAIN, {}).get("catalogue") or {}
            settings = cat.get("settings") if isinstance(cat, dict) else {}
            pricing = settings.get("pricing") if isinstance(settings, dict) else {}
            cids = pricing.get("cost_entity_ids") if isinstance(pricing, dict) else []
            entity_ids = [x for x in cids if isinstance(x, str) and x]

        ent_reg = er.async_get(hass)

        bases = set()
        for eid in entity_ids:
            try:
                base = derive_base_slug(eid)
            except Exception:  # noqa: BLE001
                continue
            bases.add(base)

        candidates = []
        removed = []

        def is_entity_present(entity_id: str) -> bool:
            return hass.states.get(entity_id) is not None or ent_reg.async_get(entity_id) is not None

        for base in sorted(bases):
            expected = []
            expected.append(("integration", f"{base}_kwh_total", f"sensor.{base}_kwh_total"))
            for suf in ("day", "week", "month", "year"):
                expected.append(("utility_meter", f"{base}_kwh_{suf}", f"sensor.{base}_kwh_{suf}"))

            for domain, name, entity_id in expected:
                if domain not in types:
                    continue

                entries = _find_config_entries_by_name(hass, domain=domain, name=name)
                if not entries:
                    continue

                stale = not is_entity_present(entity_id)
                if stale_only and not stale:
                    continue

                for e in entries:
                    candidates.append(
                        {
                            "domain": domain,
                            "name": name,
                            "entity_id": entity_id,
                            "entry_id": e.entry_id,
                            "stale": stale,
                        }
                    )

        if not dry_run:
            for c in candidates:
                try:
                    await hass.config_entries.async_remove(c["entry_id"])
                    removed.append(c)
                except Exception:  # noqa: BLE001
                    continue

            await hass.async_block_till_done()

        return self.json(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "input": {"dry_run": dry_run, "stale_only": stale_only, "types": types, "entity_ids": entity_ids},
                "candidates": candidates,
                "removed": removed,
            }
        )
