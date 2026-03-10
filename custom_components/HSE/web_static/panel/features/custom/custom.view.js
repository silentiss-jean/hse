(function () {
  const { el, clear } = window.hse_dom;

  const THEMES = [
    { key: "ha", label: "Home Assistant (thème HA)" },
    { key: "dark", label: "Dark (sobre)" },
    { key: "light", label: "Light" },
    { key: "ocean", label: "Ocean" },
    { key: "forest", label: "Forest" },
    { key: "sunset", label: "Sunset" },
    { key: "minimal", label: "Minimal" },
    { key: "neon", label: "Neon" },
    { key: "aurora", label: "Aurora (glass)" },
    { key: "neuro", label: "Neuro (soft light)" },
  ];

  const MODES = [
    { key: "auto", label: "auto" },
    { key: "mixed", label: "mixed" },
    { key: "manual", label: "manual" },
  ];

  function _as_list(v) {
    return Array.isArray(v) ? v : [];
  }

  function _keys_sorted(obj) {
    try {
      return Object.keys(obj || {}).sort();
    } catch (_) {
      return [];
    }
  }

  function _fmt_ts(ts) {
    if (!ts) return null;
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return String(ts);
      return d.toLocaleString();
    } catch (_) {
      return String(ts);
    }
  }

  function _render_sync_tables(card, pending) {
    const rooms = pending?.rooms || {};
    const assignments = pending?.assignments || {};

    const create_rooms = _as_list(rooms.create);
    const rename_rooms = _as_list(rooms.rename);
    const suggest_room = _as_list(assignments.suggest_room);

    const add_table = (title, headers, rows) => {
      card.appendChild(el("div", "hse_subtitle", title));

      if (!rows.length) {
        card.appendChild(el("div", "hse_subtitle", "—"));
        return;
      }

      const wrap = el("div", "hse_scroll_area");
      const table = el("table", "hse_table");
      const thead = el("thead");
      const trh = el("tr");
      for (const h of headers) trh.appendChild(el("th", null, h));
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = el("tbody");
      for (const r of rows) {
        const tr = el("tr");
        for (const c of r) tr.appendChild(el("td", null, c == null ? "" : String(c)));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
    };

    add_table(
      "Créations de pièces",
      ["Nom", "room_id", "ha_area_id"],
      create_rooms.map((x) => [x?.name, x?.room_id, x?.ha_area_id])
    );

    add_table(
      "Renommages de pièces",
      ["room_id", "De", "Vers", "Eligible (auto)"],
      rename_rooms.map((x) => [x?.room_id, x?.from, x?.to, x?.eligible ? "oui" : "non"])
    );

    add_table(
      "Suggestions d’affectation (pièce)",
      ["entity_id", "De", "Vers", "Raison"],
      suggest_room.map((x) => [x?.entity_id, x?.from_room_id || "—", x?.to_room_id, x?.reason || "—"])
    );
  }

  function _make_select_mode(value, on_change) {
    const select = document.createElement("select");
    select.className = "hse_input";
    select.style.display = "inline-block";
    select.style.visibility = "visible";
    select.style.pointerEvents = "auto";

    for (const m of MODES) {
      const opt = document.createElement("option");
      opt.value = m.key;
      opt.textContent = m.label;
      select.appendChild(opt);
    }

    select.value = value || "mixed";
    select.addEventListener("change", (ev) => on_change(ev.target.value));
    return select;
  }

  function _make_select_room(rooms, value, on_change) {
    const select = document.createElement("select");
    select.className = "hse_input";
    select.style.display = "inline-block";
    select.style.visibility = "visible";
    select.style.pointerEvents = "auto";
    select.style.minWidth = "160px";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "—";
    select.appendChild(opt0);

    for (const room_id of _keys_sorted(rooms || {})) {
      const r = rooms[room_id] || {};
      const opt = document.createElement("option");
      opt.value = room_id;
      opt.textContent = r?.name ? `${r.name} (${room_id})` : room_id;
      select.appendChild(opt);
    }

    select.value = value || "";
    select.addEventListener("change", (ev) => on_change(ev.target.value || null));
    return select;
  }

  function render_customisation(container, state, org_state, on_action) {
    clear(container);

    // --- Appearance
    const card = el("div", "hse_card");
    card.appendChild(el("div", null, "Apparence & Thème"));
    card.appendChild(el("div", "hse_subtitle", "Le thème s’applique à tous les onglets du panel (stocké dans ce navigateur)."));

    const row = el("div", "hse_toolbar");

    const select = document.createElement("select");
    select.className = "hse_input";
    select.style.display = "inline-block";
    select.style.visibility = "visible";
    select.style.pointerEvents = "auto";
    select.style.minWidth = "220px";

    for (const t of THEMES) {
      const opt = document.createElement("option");
      opt.value = t.key;
      opt.textContent = t.label;
      select.appendChild(opt);
    }

    select.value = state?.theme || "ha";
    select.addEventListener("change", (ev) => on_action("set_theme", ev.target.value));

    row.appendChild(select);
    card.appendChild(row);

    const toggles = el("div", "hse_badges");

    const btn_bg = el("button", "hse_button", state?.dynamic_bg ? "Fond: ON" : "Fond: OFF");
    btn_bg.addEventListener("click", () => on_action("toggle_dynamic_bg"));
    toggles.appendChild(btn_bg);

    const btn_glass = el("button", "hse_button", state?.glass ? "Glass: ON" : "Glass: OFF");
    btn_glass.addEventListener("click", () => on_action("toggle_glass"));
    toggles.appendChild(btn_glass);

    card.appendChild(toggles);
    container.appendChild(card);

    // --- Organisation / Sync
    const org = el("div", "hse_card");
    org.appendChild(el("div", null, "Organisation & Sync HA"));
    org.appendChild(
      el(
        "div",
        "hse_subtitle",
        "Prévisualise puis applique des propositions (pièces/affectations) à partir des zones Home Assistant."
      )
    );

    const meta_store = org_state?.meta_store || null;
    const sync = meta_store?.sync || null;
    const pending = sync?.pending_diff || null;
    const stats = pending?.stats || null;
    const has_pending = !!(pending && pending.has_changes);

    const draft = org_state?.meta_draft || null;
    const rooms = draft?.rooms || meta_store?.meta?.rooms || {};
    const assignments = draft?.assignments || meta_store?.meta?.assignments || {};

    if (sync?.last_error) {
      org.appendChild(el("pre", "hse_code", String(sync.last_error)));
    }

    const summary = [];
    if (has_pending) {
      const c_rooms = stats?.create_rooms ?? 0;
      const r_rooms = stats?.rename_rooms ?? 0;
      const s_room = stats?.suggest_room ?? 0;
      summary.push(`Pièces: +${c_rooms}`);
      summary.push(`renommages: ${r_rooms}`);
      summary.push(`suggestions: ${s_room}`);
    } else {
      summary.push("Aucune proposition en attente.");
    }

    if (sync?.pending_generated_at) {
      const ts = _fmt_ts(sync.pending_generated_at);
      if (ts) summary.push(`Généré: ${ts}`);
    }

    if (org_state?.dirty) {
      summary.push("Brouillon modifié (non sauvegardé)");
    }

    org.appendChild(el("div", "hse_subtitle", summary.join(", ")));

    const tb = el("div", "hse_toolbar");

    const btn_refresh = el("button", "hse_button", org_state?.loading ? "Chargement…" : "Rafraîchir");
    btn_refresh.disabled = !!org_state?.loading;
    btn_refresh.addEventListener("click", () => on_action("org_refresh"));
    tb.appendChild(btn_refresh);

    const btn_preview = el("button", "hse_button hse_button_primary", org_state?.preview_running ? "Prévisualisation…" : "Prévisualiser");
    btn_preview.disabled = !!org_state?.preview_running || !!org_state?.loading || !!org_state?.apply_running;
    btn_preview.addEventListener("click", () => on_action("org_preview"));
    tb.appendChild(btn_preview);

    const btn_apply_auto = el("button", "hse_button", "Appliquer (auto)");
    btn_apply_auto.disabled = !has_pending || !!org_state?.apply_running || !!org_state?.loading || !!org_state?.preview_running;
    btn_apply_auto.addEventListener("click", () => on_action("org_apply", { apply_mode: "auto" }));
    tb.appendChild(btn_apply_auto);

    const btn_apply_all = el("button", "hse_button", "Appliquer (all)");
    btn_apply_all.disabled = !has_pending || !!org_state?.apply_running || !!org_state?.loading || !!org_state?.preview_running;
    btn_apply_all.addEventListener("click", () => on_action("org_apply", { apply_mode: "all" }));
    tb.appendChild(btn_apply_all);

    const btn_save = el("button", "hse_button", org_state?.saving ? "Sauvegarde…" : "Sauvegarder");
    btn_save.disabled = !org_state?.dirty || !!org_state?.saving || !!org_state?.loading || !!org_state?.preview_running || !!org_state?.apply_running;
    btn_save.addEventListener("click", () => on_action("org_save"));
    tb.appendChild(btn_save);

    const btn_reset = el("button", "hse_button", "Reset brouillon");
    btn_reset.disabled = !org_state?.dirty || !!org_state?.saving;
    btn_reset.addEventListener("click", () => on_action("org_draft_reset"));
    tb.appendChild(btn_reset);

    const btn_raw = el("button", "hse_button", org_state?.show_raw ? "Mode debug: ON" : "Mode debug: OFF");
    btn_raw.addEventListener("click", () => on_action("org_toggle_raw"));
    tb.appendChild(btn_raw);

    org.appendChild(tb);

    if (org_state?.message) {
      org.appendChild(el("div", "hse_subtitle", String(org_state.message)));
    }

    if (org_state?.error) {
      org.appendChild(el("pre", "hse_code", String(org_state.error)));
    }

    if (has_pending) {
      _render_sync_tables(org, pending);
    }

    // --- Rooms editor
    const room_card = el("div", "hse_card");
    room_card.appendChild(el("div", null, "Pièces (rooms)"));
    room_card.appendChild(el("div", "hse_subtitle", `Total: ${_keys_sorted(rooms).length}`));

    const room_tb = el("div", "hse_toolbar");

    const room_filter = document.createElement("input");
    room_filter.className = "hse_input";
    room_filter.placeholder = "Filtrer (room_id ou nom)";
    room_filter.value = org_state?.rooms_filter_q || "";
    room_filter.addEventListener("input", (ev) => on_action("org_filter_rooms", ev.target.value));
    room_tb.appendChild(room_filter);

    const btn_room_add = el("button", "hse_button", "Ajouter");
    btn_room_add.addEventListener("click", () => {
      const name = window.prompt("Nom de la pièce ?", "");
      if (!name) return;
      const def_id = name
        .trim()
        .toLowerCase()
        .replaceAll(" ", "_")
        .replaceAll(/[^a-z0-9_\-]/g, "")
        .slice(0, 60);
      const room_id = window.prompt("room_id ?", def_id);
      if (!room_id) return;
      on_action("org_room_add", { room_id: room_id.trim(), name: name.trim() });
    });
    room_tb.appendChild(btn_room_add);

    room_card.appendChild(room_tb);

    const room_wrap = el("div", "hse_scroll_area");
    const room_table = el("table", "hse_table");

    const rthead = el("thead");
    const rtrh = el("tr");
    for (const h of ["room_id", "Nom", "mode", "name_mode", "ha_area_id", "Action"]) rtrh.appendChild(el("th", null, h));
    rthead.appendChild(rtrh);
    room_table.appendChild(rthead);

    const rtbody = el("tbody");
    const q = String(org_state?.rooms_filter_q || "").trim().toLowerCase();

    for (const room_id of _keys_sorted(rooms)) {
      const r = rooms[room_id] || {};
      const name = String(r?.name || "");
      const key = `${room_id} ${name}`.toLowerCase();
      if (q && !key.includes(q)) continue;

      const tr = el("tr");
      tr.appendChild(el("td", null, room_id));

      const td_name = el("td");
      const inp_name = document.createElement("input");
      inp_name.className = "hse_input";
      inp_name.value = name;
      inp_name.addEventListener("change", (ev) => on_action("org_patch", { path: `rooms.${room_id}.name`, value: ev.target.value }));
      td_name.appendChild(inp_name);
      tr.appendChild(td_name);

      const td_mode = el("td");
      td_mode.appendChild(
        _make_select_mode(r?.mode || "mixed", (v) => on_action("org_patch", { path: `rooms.${room_id}.mode`, value: v }))
      );
      tr.appendChild(td_mode);

      const td_nm = el("td");
      td_nm.appendChild(
        _make_select_mode(r?.name_mode || "mixed", (v) => on_action("org_patch", { path: `rooms.${room_id}.name_mode`, value: v }))
      );
      tr.appendChild(td_nm);

      tr.appendChild(el("td", null, r?.ha_area_id || "—"));

      const td_act = el("td");
      const btn_del = el("button", "hse_button", "Supprimer");
      btn_del.addEventListener("click", () => {
        const ok = window.confirm(`Supprimer la room ${room_id} ?`);
        if (!ok) return;
        on_action("org_room_delete", { room_id });
      });
      td_act.appendChild(btn_del);
      tr.appendChild(td_act);

      rtbody.appendChild(tr);
    }

    room_table.appendChild(rtbody);
    room_wrap.appendChild(room_table);
    room_card.appendChild(room_wrap);
    container.appendChild(room_card);

    // --- Assignments editor
    const asg_card = el("div", "hse_card");
    asg_card.appendChild(el("div", null, "Affectations (assignments)"));
    asg_card.appendChild(el("div", "hse_subtitle", `Total: ${_keys_sorted(assignments).length}`));

    const asg_tb = el("div", "hse_toolbar");

    const asg_filter = document.createElement("input");
    asg_filter.className = "hse_input";
    asg_filter.placeholder = "Filtrer (entity_id / room_id / type_id)";
    asg_filter.value = org_state?.assignments_filter_q || "";
    asg_filter.addEventListener("input", (ev) => on_action("org_filter_assignments", ev.target.value));
    asg_tb.appendChild(asg_filter);

    const btn_asg_add = el("button", "hse_button", "Ajouter");
    btn_asg_add.addEventListener("click", () => {
      const entity_id = window.prompt("entity_id ?", "");
      if (!entity_id) return;
      on_action("org_assignment_add", { entity_id: entity_id.trim() });
    });
    asg_tb.appendChild(btn_asg_add);

    asg_card.appendChild(asg_tb);

    const asg_wrap = el("div", "hse_scroll_area");
    const asg_table = el("table", "hse_table");

    const athead = el("thead");
    const atrh = el("tr");
    for (const h of ["entity_id", "room_id", "room_mode", "type_id", "type_mode", "Action"]) atrh.appendChild(el("th", null, h));
    athead.appendChild(atrh);
    asg_table.appendChild(athead);

    const atbody = el("tbody");
    const qa = String(org_state?.assignments_filter_q || "").trim().toLowerCase();

    for (const entity_id of _keys_sorted(assignments)) {
      const a = assignments[entity_id] || {};
      const key = `${entity_id} ${a?.room_id || ""} ${a?.type_id || ""}`.toLowerCase();
      if (qa && !key.includes(qa)) continue;

      const tr = el("tr");
      tr.appendChild(el("td", null, entity_id));

      const td_room = el("td");
      td_room.appendChild(
        _make_select_room(rooms, a?.room_id || null, (v) => on_action("org_patch", { path: `assignments.${entity_id}.room_id`, value: v }))
      );
      tr.appendChild(td_room);

      const td_rm = el("td");
      td_rm.appendChild(
        _make_select_mode(a?.room_mode || "mixed", (v) => on_action("org_patch", { path: `assignments.${entity_id}.room_mode`, value: v }))
      );
      tr.appendChild(td_rm);

      const td_type = el("td");
      const inp_type = document.createElement("input");
      inp_type.className = "hse_input";
      inp_type.value = a?.type_id || "";
      inp_type.placeholder = "(optionnel)";
      inp_type.addEventListener("change", (ev) => on_action("org_patch", { path: `assignments.${entity_id}.type_id`, value: ev.target.value || null }));
      td_type.appendChild(inp_type);
      tr.appendChild(td_type);

      const td_tm = el("td");
      td_tm.appendChild(
        _make_select_mode(a?.type_mode || "mixed", (v) => on_action("org_patch", { path: `assignments.${entity_id}.type_mode`, value: v }))
      );
      tr.appendChild(td_tm);

      const td_act = el("td");
      const btn_del = el("button", "hse_button", "Supprimer");
      btn_del.addEventListener("click", () => {
        const ok = window.confirm(`Supprimer l'affectation ${entity_id} ?`);
        if (!ok) return;
        on_action("org_assignment_delete", { entity_id });
      });
      td_act.appendChild(btn_del);
      tr.appendChild(td_act);

      atbody.appendChild(tr);
    }

    asg_table.appendChild(atbody);
    asg_wrap.appendChild(asg_table);
    asg_card.appendChild(asg_wrap);
    container.appendChild(asg_card);

    if (org_state?.show_raw) {
      const raw = {
        meta_store,
        meta_draft: org_state?.meta_draft || null,
      };
      org.appendChild(el("div", "hse_subtitle", "Données brutes"));
      org.appendChild(el("pre", "hse_code", JSON.stringify(raw, null, 2)));
    }

    container.appendChild(org);
  }

  window.hse_custom_view = { render_customisation };
})();
