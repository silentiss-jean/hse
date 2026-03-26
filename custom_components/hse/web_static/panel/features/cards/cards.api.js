(function () {
  "use strict";

  async function fetch_lovelace_sensors(hass) {
    const resp = await window.hse_fetch(hass, 'GET', 'hse/unified/catalogue');

    const items = resp?.items || {};
    const sensors = [];

    for (const [_id, item] of Object.entries(items)) {
      if (!item || !item.source) continue;

      const policy = item.triage?.policy || 'active';
      if (policy === 'removed' || policy === 'archived') continue;

      const entity_id = item.source.entity_id;
      if (!entity_id) continue;

      const kind          = item.source.kind || '';
      const unit          = item.source.unit || item.source.unit_of_measurement || '';
      const device_class  = item.source.device_class || '';
      const friendly_name = item.source.friendly_name || item.source.name || entity_id;
      const state         = item.source.last_value ?? item.source.state ?? null;

      sensors.push({
        entity_id,
        state: state !== null ? String(state) : '0',
        attributes: { friendly_name, unit_of_measurement: unit, device_class },
        _kind: kind,
      });
    }

    sensors.sort((a, b) =>
      (a.attributes.friendly_name || '').localeCompare(b.attributes.friendly_name || '', 'fr')
    );

    return sensors;
  }

  async function fetch_sensors_enriched(hass) {
    const [sensors, org_resp] = await Promise.all([
      fetch_lovelace_sensors(hass),
      window.hse_fetch(hass, 'GET', 'hse/unified/meta').catch(() => null),
    ]);

    const meta        = org_resp?.meta_store?.meta || {};
    const rooms_raw   = meta.rooms || {};
    const assignments = meta.assignments || {};

    const rooms = {};
    if (Array.isArray(rooms_raw)) {
      rooms_raw.forEach((r) => { if (r && r.id) rooms[r.id] = r; });
    } else {
      Object.assign(rooms, rooms_raw);
    }

    return sensors.map((s) => {
      const assign    = assignments[s.entity_id] || {};
      const room_id   = assign.room_id || null;
      const room_cfg  = room_id ? (rooms[room_id] || {}) : {};
      return Object.assign({}, s, {
        room_id,
        room_name:      room_cfg.name || room_id || null,
        room_icon:      room_cfg.icon || 'mdi:home',
        lovelace_title: room_cfg.lovelace_title || room_cfg.name || room_id || null,
        type_id:        assign.type_id || null,
      });
    });
  }

  window.hse_cards_api = { fetch_lovelace_sensors, fetch_sensors_enriched };
})();
