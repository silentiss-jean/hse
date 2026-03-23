/* migration.view.js */
(function () {
  const { el, clear } = window.hse_dom;

  function _as_text(x) {
    if (x == null) return "";
    if (typeof x === "string") return x;
    try {
      return JSON.stringify(x, null, 2);
    } catch (_) {
      return String(x);
    }
  }

  function _mk_card(title, subtitle, actions, body) {
    const card = el("div", "hse_card");
    const head = el("div", "hse_card_header");
    head.appendChild(el("div", null, title));

    const act = el("div", "hse_card_actions");
    for (const a of actions || []) act.appendChild(a);
    head.appendChild(act);

    card.appendChild(head);
    if (subtitle) card.appendChild(el("div", "hse_subtitle", subtitle));
    if (body) card.appendChild(body);
    return card;
  }

  function _btn(label, cls, onClick, disabled) {
    const b = el("button", cls || "hse_button", label);
    b.disabled = !!disabled;
    b.addEventListener("click", onClick);
    return b;
  }

  function render_migration(container, state, on_action) {
    clear(container);

    container.appendChild(
      _mk_card(
        "Migration vers helpers Home Assistant",
        "Exportez vos capteurs sélectionnés vers des helpers natifs Home Assistant (integration + utility_meter + templates).",
        [],
        null
      )
    );

    const grid = el("div", "hse_grid_2col");

    const mkBox = (optTitle, optSubtitle, optKey) => {
      const body = el("div");
      const actions = [
        _btn(
          "Exporter",
          "hse_button hse_button_primary",
          () => on_action("export", { option: optKey }),
          !!state.loading
        ),
        _btn("Preview YAML", "hse_button", () => on_action("preview", { option: optKey }), !!state.loading),
      ];

      return _mk_card(optTitle, optSubtitle, actions, body);
    };

    grid.appendChild(
      mkBox(
        "Option 1 – Utility Meter YAML",
        "Génère les utility_meter day/week/month/year (source: kWh total).",
        "option1_utility_meter_yaml"
      )
    );
    grid.appendChild(
      mkBox(
        "Option 2 – Template/Integration (Riemann)",
        "Génère les capteurs énergie (kWh total) à partir des capteurs puissance.",
        "option2_templates_riemann_yaml"
      )
    );
    grid.appendChild(
      mkBox(
        "Option 3 – Génération capteurs coût (starter)",
        "Génère des templates de coût (contrat fixe uniquement pour l'instant).",
        "option3_cost_sensors_yaml"
      )
    );

    container.appendChild(grid);

    if (state.error) {
      const card = el("div", "hse_card");
      card.appendChild(el("div", null, "Erreur"));
      card.appendChild(el("pre", "hse_code", String(state.error)));
      container.appendChild(card);
    }

    if (state.last && state.last.exports) {
      const card = el("div", "hse_card");
      card.appendChild(el("div", null, "Export YAML"));
      if (Array.isArray(state.last.warnings) && state.last.warnings.length) {
        card.appendChild(el("div", "hse_subtitle", `Warnings: ${state.last.warnings.join(" | ")}`));
      }

      const toolbar = el("div", "hse_toolbar");
      const btnCopy = _btn(
        "Copier",
        "hse_button",
        async () => {
          try {
            await navigator.clipboard.writeText(state.active_yaml || "");
          } catch (_) {}
        },
        !state.active_yaml
      );
      toolbar.appendChild(btnCopy);
      card.appendChild(toolbar);

      const pre = el("pre", "hse_code hse_mono");
      pre.textContent = state.active_yaml || _as_text(state.last.exports);
      card.appendChild(pre);

      container.appendChild(card);
    }
  }

  window.hse_migration_view = { render_migration };
})();
