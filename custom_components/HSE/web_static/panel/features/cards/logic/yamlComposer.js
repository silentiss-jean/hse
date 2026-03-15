(function () {
  "use strict";

  // ──────────────────────────────────────────────────────────────────────────
  // OVERVIEW (historique) — CORRIGÉ : history-graph entities avec clé "entity:"
  // ──────────────────────────────────────────────────────────────────────────
  function _build_overview_yaml(sensors) {
    const lines = [];
    lines.push("# ⚡ HSE - Dashboard Auto-généré");
    lines.push(`# Généré le ${new Date().toLocaleString("fr-FR")}`);
    lines.push(`# ${sensors.length} sensors inclus`);
    lines.push("");
    lines.push("title: ⚡ Home Suivi Elec");
    lines.push("views:");
    lines.push("  - title: Vue d'ensemble");
    lines.push("    path: overview");
    lines.push("    icon: mdi:home-analytics");
    lines.push("    cards:");
    lines.push("      - type: entities");
    lines.push(`        title: 📊 Top ${sensors.length} consommateurs`);
    lines.push("        show_header_toggle: false");
    lines.push("        entities:");
    for (const s of sensors) {
      lines.push(`          - entity: ${s.entity_id}`);
    }
    lines.push("");
    lines.push("      - type: history-graph");
    lines.push("        title: 📈 Consommation 7 derniers jours");
    lines.push("        hours_to_show: 168");
    lines.push("        entities:");
    // FIX : format objet avec clé "entity:" (requis par HA depuis 2023.4)
    for (const s of sensors.slice(0, Math.min(5, sensors.length))) {
      lines.push(`          - entity: ${s.entity_id}`);
    }
    return lines.join("\n") + "\n";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DISTRIBUTION — type: distribution (HA built-in)
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
  // SENSOR — type: sensor (une entité, graphique courbe)
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
  // MULTI-SENSOR — grille de cartes sensor (une par capteur _kwh_day)
  // ──────────────────────────────────────────────────────────────────────────
  function _build_multi_sensor_yaml(sensors) {
    const daily = sensors
      .filter((s) => {
        const eid = String(s.entity_id || "").toLowerCase();
        return eid.includes("_kwh_day") || eid.includes("_kwh_d") || eid.includes("_day");
      })
      .sort((a, b) => parseFloat(b.state || 0) - parseFloat(a.state || 0))
      .slice(0, 12);
    const to_use = daily.length ? daily : sensors.slice(0, 12);

    const lines = [];
    lines.push("# ⚡ HSE - Grille de capteurs kWh/jour");
    lines.push(`# Généré le ${new Date().toLocaleString("fr-FR")}`);
    lines.push(`# ${to_use.length} capteurs`);
    lines.push("");
    lines.push("title: ⚡ Home Suivi Elec");
    lines.push("views:");
    lines.push("  - title: Consommation journalière");
    lines.push("    path: daily");
    lines.push("    icon: mdi:lightning-bolt");
    lines.push("    cards:");
    for (const s of to_use) {
      const name = s.attributes?.friendly_name || s.entity_id;
      lines.push("      - type: sensor");
      lines.push(`        entity: ${s.entity_id}`);
      lines.push(`        name: ${_yaml_quote(name)}`);
      lines.push("        graph: line");
      lines.push("        hours_to_show: 24");
      lines.push("");
    }
    return lines.join("\n") + "\n";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // POWER FLOW CARD PLUS
  // ──────────────────────────────────────────────────────────────────────────
  function _yaml_quote(value) {
    const str = String(value ?? "");
    return `"${str.replace(/"/g, '\\"')}"`;
  }

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

  function _build_power_flow_yaml(options) {
    const title = (options.title || "").trim();
    const grid_power_entity = String(options.grid?.power_entity || "").trim();
    const home_power_entity = String(options.home?.power_entity || "").trim();
    const home_cost_entity = String(options.home?.cost_entity || "").trim();
    const individuals = Array.isArray(options.individuals) ? options.individuals : [];

    const lines = [];
    lines.push("type: custom:power-flow-card-plus");
    lines.push("entities:");
    lines.push("  battery:");
    lines.push('    entity: ""');
    lines.push('    state_of_charge: ""');
    lines.push("  grid:");
    lines.push("    secondary_info: {}");
    lines.push("    entity:");
    lines.push(`      consumption: ${grid_power_entity}`);
    lines.push("    invert_state: false");
    lines.push("    name: Compteur");
    lines.push("    icon: mdi:generator-stationary");
    lines.push("    color_icon: true");
    lines.push("    color_circle: production");
    lines.push("    display_state: one_way_no_zero");
    lines.push("  home:");
    _push_cost_secondary_info(lines, "    ", home_cost_entity);
    if (title) lines.push(`    name: ${_yaml_quote(title)}`);
    lines.push("    icon: mdi:home");
    lines.push(`    entity: ${home_power_entity ? home_power_entity : '""'}`);
    lines.push("    subtract_individual: false");
    lines.push("    override_state: true");
    lines.push("  individual:");

    const safe = individuals
      .map((r) => ({
        power_entity: String(r?.power_entity || "").trim(),
        cost_entity: String(r?.cost_entity || "").trim(),
        name: String(r?.name || "").trim(),
      }))
      .filter((r) => r.power_entity);

    if (!safe.length) {
      lines.push("    []");
      return lines.join("\n") + "\n";
    }

    for (const row of safe) {
      lines.push(`    - entity: ${row.power_entity}`);
      _push_cost_secondary_info(lines, "      ", row.cost_entity);
      if (row.name) lines.push(`      name: ${_yaml_quote(row.name)}`);
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
    const card_type = Array.isArray(cardTypes) && cardTypes.length ? cardTypes[0] : "overview";

    switch (card_type) {
      case "power_flow_card_plus":
        return _build_power_flow_yaml(options || {});

      case "distribution":
        return _build_distribution_yaml(sensors || []);

      case "sensor": {
        // Prend le premier sensor sélectionné (options.sensor_entity_id) ou le top 1
        const eid = options?.sensor_entity_id;
        const s = eid ? (sensors || []).find((x) => x.entity_id === eid) : (sensors || [])[0];
        return _build_sensor_yaml(s);
      }

      case "multi_sensor":
        return _build_multi_sensor_yaml(sensors || []);

      default: // "overview"
        return _build_overview_yaml(sensors || []);
    }
  }

  window.hse_cards_yaml = { generate_dashboard_yaml };
})();
