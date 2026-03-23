/*
HSE_DOC: custom_components/hse/docs/panel_shell.md
HSE_MAINTENANCE: If you change navigation items or shell DOM contracts, update the doc above.
*/

(function () {
  const { el, clear } = window.hse_dom;

  function create_shell(root, ctx) {
    clear(root);

    const page = el("div", "hse_page");
    const shell = el("div", "hse_shell");

    const header = el("div", "hse_header");

    const left = el("div");
    left.appendChild(el("h1", "hse_title", "Home Suivi Elec"));
    left.appendChild(el("div", "hse_subtitle", "Panel v2 (modulaire)"));

    const right = el("div", "hse_subtitle", `user: ${ctx.user_name || "—"}`);

    header.appendChild(left);
    header.appendChild(right);

    const tabs = el("div", "hse_tabs");
    const content = el("div");

    shell.appendChild(header);
    shell.appendChild(tabs);
    shell.appendChild(content);

    page.appendChild(shell);
    root.appendChild(page);

    return { tabs, content, header_right: right };
  }

  function get_nav_items() {
    // ids = routes internes (features)
    return [
      { id: "overview", label: "Accueil" },
      { id: "diagnostic", label: "Diagnostic" },
      { id: "scan", label: "Détection" },
      { id: "enrich", label: "Enrichissement" },
      { id: "config", label: "Configuration" },
      { id: "custom", label: "Customisation" },
      { id: "cards", label: "Génération cartes" },
      { id: "migration", label: "Migration capteurs" },
      { id: "costs", label: "Analyse de coûts" },
    ];
  }

  function render_tabs(tabs_node, active_tab, on_tab) {
    clear(tabs_node);

    for (const it of get_nav_items()) {
      const b = el("button", "hse_tab", it.label);
      b.dataset.active = it.id === active_tab ? "true" : "false";
      b.addEventListener("click", () => on_tab(it.id));
      tabs_node.appendChild(b);
    }
  }

  window.hse_shell = { create_shell, render_tabs, get_nav_items };
})();
