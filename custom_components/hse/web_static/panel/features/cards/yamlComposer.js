(function () {
  "use strict";

  function _yaml_quote(value) {
    const str = String(value ?? "");
    return `"${str.replace(/"/g, '\\"')}"`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DISTRIBUTION
  // ──────────────────────────────────────────────────────────────────────────
  function _build_distribution_yaml(sensors) {
    const power = sensors.filter((s) => {
      const eid = String(s.entity_id || "").toLowerCase();
      const dc = String(s.attributes?.device_class || "").toLowerCase();
      const unit = String(s.attributes?.unit_of_measurement || "").toLowerCase();
      return dc === "power" || unit === "w" || unit === "kw" || eid.includes("_power") || eid.includes("puissance");
    });
    const to_use = power.length ? power : sensors;
    const top = to_use
      .sort((a, b) => parseFloat(b.state || 0) - parseFloat(a.state || 0))
      .slice(0, 8);

    const lines = [];
    lines.push("# ⚡ HSE - Carte Distribution de puissance");
    lines.push(`# Généré le ${new Date().toLocaleString("fr-FR")}`);
    lines.push("");
    lines.push("type: distribution");
    lines.push("entities:");
    for (const s of top) {
      lines.push(`  - ${s.entity_id}`);
    }
    return lines.join("\n") + "\n";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SENSOR individuel
  // ──────────────────────────────────────────────────────────────────────────
  function _build_sensor_yaml(sensor) {
    if (!sensor) return "# Aucun sensor disponible\n";
    const lines = [];
    lines.push("# ⚡ HSE - Carte capteur individuel");
    lines.push(`# Généré le ${new Date().toLocaleString("fr-FR")}`);
    lines.push("");
    lines.push("type: sensor");
    lines.push(`entity: ${sensor.entity_id}`);
    lines.push("graph: line");
    lines.push("hours_to_show: 24");
    return lines.join("\n") + "\n";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POWER FLOW CARD PLUS — auto-généré depuis sensors_enriched
  // Reçoit directement this._sensors_enriched du controller
  // ──────────────────────────────────────────────────────────────────────────
  function _push_cost_secondary_info(lines, indent, entity_id) {
    if (!entity_id) {
      lines.push(`${indent}secondary_info: {}`);
      return;
    }
    lines.push(`${indent}secondary_info:`);
    lines.push(`${indent}  entity: ${entity_id}`);
    lines.push(`${indent}  unit_of_measurement: €`);
    lines.push(`${indent}  decimals: 2`);
  }

  function _is_power_sensor(s) {
    const eid = String(s.entity_id || "").toLowerCase();
    const dc = String(s.attributes?.device_class || "").toLowerCase();
    const unit = String(s.attributes?.unit_of_measurement || "").toLowerCase();
    return (
      s._kind === "power" ||
      dc === "power" ||
      unit === "w" ||
      unit === "kw" ||
      eid.includes("_power") ||
      eid.includes("puissance")
    );
  }

  function _is_cost_daily_ttc(s) {
    const eid = String(s.entity_id || "").toLowerCase();
    return eid.includes("_cout_daily") && eid.includes("_ttc");
  }

  function _build_power_flow_yaml(sensors_enriched) {
    const all = sensors_enriched || [];

    // Grid power = premier sensor power sans room_id (consommation totale)
    const all_power = all.filter(_is_power_sensor);
    const grid_sensor = all_power.find((s) => !s.room_id) || all_power[0] || null;
    const grid_power_entity = grid_sensor ? grid_sensor.entity_id : "";

    // Home cost = premier sensor cost_daily_ttc sans room_id
    const all_cost = all.filter(_is_cost_daily_ttc);
    const home_cost_sensor = all_cost.find((s) => !s.room_id) || null;
    const home_cost_entity = home_cost_sensor ? home_cost_sensor.entity_id : "";

    // Individuals = un power + un cost par room_id
    const rooms = new Map();
    for (const s of all) {
      if (!s.room_id) continue;
      if (!rooms.has(s.room_id)) {
        rooms.set(s.room_id, {
          room_name: s.room_name || s.room_id,
          power_entity: "",
          cost_entity: "",
        });
      }
      const r = rooms.get(s.room_id);
      if (!r.power_entity && _is_power_sensor(s)) r.power_entity = s.entity_id;
      if (!r.cost_entity && _is_cost_daily_ttc(s)) r.cost_entity = s.entity_id;
    }

    const individuals = [...rooms.values()].filter((r) => r.power_entity);

    const lines = [];
    lines.push("# ⚡ HSE - Power Flow Card Plus (auto-généré)");
    lines.push(`# Généré le ${new Date().toLocaleString("fr-FR")}`);
    lines.push(`# ${individuals.length} pièce(s) détectée(s)`);
    lines.push("");
    lines.push("type: custom:power-flow-card-plus");
    lines.push("entities:");
    lines.push("  battery:");
    lines.push('    entity: ""');
    lines.push('    state_of_charge: ""');
    lines.push("  grid:");
    lines.push("    secondary_info: {}");
    lines.push("    entity:");
    lines.push(`      consumption: ${grid_power_entity || '""'}`);
    lines.push("    invert_state: false");
    lines.push("    name: Compteur");
    lines.push("    icon: mdi:generator-stationary");
    lines.push("    color_icon: true");
    lines.push("    color_circle: production");
    lines.push("    display_state: one_way_no_zero");
    lines.push("  home:");
    _push_cost_secondary_info(lines, "    ", home_cost_entity);
    lines.push("    icon: mdi:home");
    lines.push('    entity: ""');
    lines.push("    subtract_individual: false");
    lines.push("    override_state: true");
    lines.push("  individual:");

    if (!individuals.length) {
      lines.push("    []");
      return lines.join("\n") + "\n";
    }

    for (const row of individuals) {
      lines.push(`    - entity: ${row.power_entity}`);
      _push_cost_secondary_info(lines, "      ", row.cost_entity);
      lines.push(`      name: ${_yaml_quote(row.room_name)}`);
      lines.push("      display_zero: true");
      lines.push("      unit_white_space: true");
      lines.push("      calculate_flow_rate: true");
      lines.push("      show_direction: true");
      lines.push("      use_metadata: true");
    }

    return lines.join("\n") + "\n";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Point d'entrée
  // ──────────────────────────────────────────────────────────────────────────
  function generate_dashboard_yaml({ sensors, cardTypes, options }) {
    const card_type = Array.isArray(cardTypes) && cardTypes.length ? cardTypes[0] : "distribution";

    switch (card_type) {
      case "power_flow_card_plus":
        // sensors = this._sensors_enriched passé par le controller
        return _build_power_flow_yaml(sensors || []);

      case "distribution":
        return _build_distribution_yaml(sensors || []);

      case "sensor": {
        const eid = options?.sensor_entity_id;
        const s = eid ? (sensors || []).find((x) => x.entity_id === eid) : (sensors || [])[0];
        return _build_sensor_yaml(s);
      }

      default:
        return _build_distribution_yaml(sensors || []);
    }
  }

  window.hse_cards_yaml = { generate_dashboard_yaml };
})();
