(function () {
  const { el, clear } = window.hse_dom;
  const { render_table } = window.hse_table;

  function _filter_candidates(candidates, q) {
    if (!q) return candidates;
    const needle = q.toLowerCase();
    return candidates.filter((c) => {
      const hay = `${c.entity_id} ${c.name} ${c.integration_domain} ${c.kind} ${c.unit} ${c.state_class} ${c.status} ${c.ha_state}`.toLowerCase();
      return hay.includes(needle);
    });
  }

  function _count_kinds(candidates) {
    let power = 0;
    let energy = 0;
    for (const c of candidates) {
      if (c.kind === "power") power += 1;
      else if (c.kind === "energy") energy += 1;
    }
    return { power, energy, total: candidates.length };
  }

  function _group_by_integration(candidates) {
    const map = new Map();
    for (const c of candidates) {
      const key = c.integration_domain || "unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    const groups = [];
    for (const [integration_domain, items] of map.entries()) {
      const counts = _count_kinds(items);
      groups.push({ integration_domain, items, counts });
    }
    groups.sort((a, b) => {
      if (b.counts.total !== a.counts.total) return b.counts.total - a.counts.total;
      return a.integration_domain.localeCompare(b.integration_domain);
    });
    return groups;
  }

  function _status_label(status) {
    const s = String(status || "").toLowerCase();
    if (s === "ok") return "ok";
    if (s === "disabled") return "disabled";
    if (s === "not_provided") return "not provided";
    if (s) return s;
    return "—";
  }

  function _status_class(status) {
    const s = String(status || "").toLowerCase();
    if (s === "ok") return "hse_badge_status_ok";
    if (s === "not_provided" || s === "disabled") return "hse_badge_status_warn";
    return "";
  }

  function _ha_state_class(ha_state, ha_restored) {
    const s = String(ha_state || "").toLowerCase();
    if (s === "unavailable" || s === "unknown") return "hse_badge_status_warn";
    if (ha_restored) return "hse_badge_status_warn";
    return "";
  }

  function _render_candidate_list(container, items) {
    clear(container);

    const list = el("div", "hse_candidate_list");

    for (const c of items) {
      const row = el("div", "hse_candidate_row");

      const main = el("div", "hse_candidate_main");
      const eid = el("div", "hse_mono", c.entity_id);
      main.appendChild(eid);

      if (c.name && c.name !== c.entity_id) {
        main.appendChild(el("div", "hse_subtitle", c.name));
      }

      const meta = el("div", "hse_candidate_meta");

      const badges = el("div", "hse_badges");
      badges.appendChild(el("span", "hse_badge", c.kind || "—"));

      if (c.status) {
        const klass = `hse_badge ${_status_class(c.status)}`.trim();
        const st = el("span", klass, `status: ${_status_label(c.status)}`);
        if (c.status_reason) st.title = String(c.status_reason);
        badges.appendChild(st);
      }

      if (c.ha_state) {
        const klass = `hse_badge ${_ha_state_class(c.ha_state, c.ha_restored)}`.trim();
        const st2 = el("span", klass, `state: ${c.ha_state}`);
        if (c.ha_restored) st2.title = "restored: true";
        badges.appendChild(st2);
      }

      if (c.unit) badges.appendChild(el("span", "hse_badge", c.unit));
      if (c.state_class) badges.appendChild(el("span", "hse_badge", c.state_class));
      if (c.disabled_by) badges.appendChild(el("span", "hse_badge hse_badge_warn", `disabled: ${c.disabled_by}`));

      meta.appendChild(badges);

      row.appendChild(main);
      row.appendChild(meta);
      list.appendChild(row);
    }

    container.appendChild(list);
  }

  function render_scan(container, scan_result, state, on_action) {
    clear(container);

    const card = el("div", "hse_card");

    const toolbar = el("div", "hse_toolbar");

    const btn = el("button", "hse_button hse_button_primary", state.scan_running ? "Scan…" : "Scanner");
    btn.disabled = !!state.scan_running;
    btn.addEventListener("click", () => on_action("scan"));

    const input = document.createElement("input");
    input.className = "hse_input";
    input.placeholder = "Filtrer (entity_id, nom, intégration, kind, status, state…)";
    input.value = state.filter_q || "";
    input.addEventListener("input", (ev) => on_action("filter", ev.target.value));

    const btn_open_all = el("button", "hse_button", "Tout ouvrir");
    btn_open_all.addEventListener("click", () => on_action("open_all"));

    const btn_close_all = el("button", "hse_button", "Tout fermer");
    btn_close_all.addEventListener("click", () => on_action("close_all"));

    toolbar.appendChild(btn);
    toolbar.appendChild(input);
    toolbar.appendChild(btn_open_all);
    toolbar.appendChild(btn_close_all);
    card.appendChild(toolbar);

    if (scan_result && scan_result.error) {
      const err = el("pre", "hse_code");
      err.textContent = String(scan_result.error);
      card.appendChild(err);
      container.appendChild(card);
      return;
    }

    const integrations = scan_result.integrations || [];
    const candidates = scan_result.candidates || [];
    const filtered = _filter_candidates(candidates, state.filter_q);
    const total_counts = _count_kinds(filtered);

    const summary = el("div", "hse_summary");
    const badges = el("div", "hse_badges");
    badges.appendChild(el("span", "hse_badge", `intégrations: ${integrations.length}`));
    badges.appendChild(el("span", "hse_badge", `candidats: ${filtered.length}/${candidates.length}`));
    badges.appendChild(el("span", "hse_badge", `power: ${total_counts.power}`));
    badges.appendChild(el("span", "hse_badge", `energy: ${total_counts.energy}`));
    summary.appendChild(badges);
    card.appendChild(summary);

    const integ_title = el("div", "hse_section_title", `Intégrations détectées`);
    card.appendChild(integ_title);

    const integ_box = el("div");
    render_table(
      integ_box,
      [
        { label: "integration", get_value: (r) => r.integration_domain },
        { label: "power", get_value: (r) => r.power_count },
        { label: "energy", get_value: (r) => r.energy_count },
        { label: "total", get_value: (r) => r.total },
      ],
      integrations
    );
    card.appendChild(integ_box);

    const cand_title = el("div", "hse_section_title", "Candidats (groupés par intégration)");
    card.appendChild(cand_title);

    const groups = _group_by_integration(filtered);
    const groups_box = el("div", "hse_groups");

    for (const g of groups) {
      const details = document.createElement("details");
      details.className = "hse_fold";

      const wanted_open = state.open_all ? true : !!state.groups_open?.[g.integration_domain];
      if (wanted_open) details.open = true;

      const summary_el = document.createElement("summary");
      summary_el.className = "hse_fold_summary";

      const left = el("div", "hse_fold_left");
      left.appendChild(el("div", "hse_fold_title", g.integration_domain));

      const right = el("div", "hse_badges");
      right.appendChild(el("span", "hse_badge", `total: ${g.counts.total}`));
      if (g.counts.energy) right.appendChild(el("span", "hse_badge", `energy: ${g.counts.energy}`));
      if (g.counts.power) right.appendChild(el("span", "hse_badge", `power: ${g.counts.power}`));

      summary_el.appendChild(left);
      summary_el.appendChild(right);

      const body = el("div", "hse_fold_body");
      body.dataset.loaded = "false";

      details.appendChild(summary_el);
      details.appendChild(body);

      details.addEventListener("toggle", () => {
        on_action("set_group_open", { id: g.integration_domain, open: details.open, no_render: true });

        if (!details.open) return;
        if (body.dataset.loaded === "true") return;
        body.dataset.loaded = "true";
        _render_candidate_list(body, g.items);
      });

      if (details.open) {
        body.dataset.loaded = "true";
        _render_candidate_list(body, g.items);
      }

      groups_box.appendChild(details);
    }

    card.appendChild(groups_box);

    const note = el(
      "div",
      "hse_subtitle",
      "Les groupes sont repliés par défaut; tu peux ouvrir/fermer individuellement ou via Tout ouvrir/Tout fermer."
    );
    card.appendChild(note);

    container.appendChild(card);
  }

  window.hse_scan_view = { render_scan };
})();
