(function () {
  "use strict";

  /**
   * Récupère les capteurs HSE du catalogue pour la génération Lovelace.
   * Filtre les items actifs (power + energy) depuis GET hse/unified/catalogue.
   * @param {Object} hass
   * @returns {Promise<Array>} Liste de capteurs compatibles lovelace
   */
  async function fetch_lovelace_sensors(hass) {
    const resp = await hass.callApi("GET", "hse/unified/catalogue");

    const items = resp?.items || {};
    const sensors = [];

    for (const [_id, item] of Object.entries(items)) {
      if (!item || !item.source) continue;

      const policy = item.triage?.policy || "active";
      if (policy === "removed" || policy === "archived") continue;

      const entity_id = item.source.entity_id;
      if (!entity_id) continue;

      const kind = item.source.kind || "";
      const unit = item.source.unit || item.source.unit_of_measurement || "";
      const device_class = item.source.device_class || "";
      const friendly_name = item.source.friendly_name || item.source.name || entity_id;
      const state = item.source.last_value ?? item.source.state ?? null;

      sensors.push({
        entity_id,
        state: state !== null ? String(state) : "0",
        attributes: {
          friendly_name,
          unit_of_measurement: unit,
          device_class,
        },
        _kind: kind,
      });
    }

    sensors.sort((a, b) => (a.attributes.friendly_name || "").localeCompare(b.attributes.friendly_name || "", "fr"));

    return sensors;
  }

  window.hse_cards_api = { fetch_lovelace_sensors };
})();
