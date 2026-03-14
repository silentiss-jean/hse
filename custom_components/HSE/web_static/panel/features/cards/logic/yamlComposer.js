(function () {
  "use strict";

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
    for (const s of sensors.slice(0, Math.min(5, sensors.length))) {
      lines.push(`          - ${s.entity_id}`);
    }
    return lines.join("\n") + "\n";
  }

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

  function generate_dashboard_yaml({ sensors, cardTypes, options }) {
    const card_type = Array.isArray(cardTypes) && cardTypes.length ? cardTypes[0] : "overview";
    if (card_type === "power_flow_card_plus") return _build_power_flow_yaml(options || {});
    return _build_overview_yaml(sensors || []);
  }

  window.hse_cards_yaml = { generate_dashboard_yaml };
})();
