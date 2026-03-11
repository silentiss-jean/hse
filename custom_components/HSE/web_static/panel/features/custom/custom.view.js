(function () {
  const { el, clear } = window.hse_dom;

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

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

  const DEFAULT_TYPE_KEYWORDS = {
    tv: "TV",
    tele: "TV",
    television: "TV",
    chromecast: "TV",
    apple_tv: "TV",
    shield: "TV",
    internet: "Internet",
    box: "Internet",
    routeur: "Internet",
    router: "Internet",
    freebox: "Internet",
    livebox: "Internet",
    nas: "Informatique",
    pc: "Informatique",
    ordi: "Informatique",
    computer: "Informatique",
    server: "Informatique",
    serveur: "Informatique",
    laptop: "Informatique",
    chauffage: "Chauffage",
    radiateur: "Chauffage",
    clim: "Chauffage",
    pac: "Chauffage",
    thermor: "Chauffage",
    atlantic: "Chauffage",
    ecs: "Eau chaude",
    ballon: "Eau chaude",
    chauffe_eau: "Eau chaude",
    cumulus: "Eau chaude",
    lave_vaisselle: "Électroménager",
    lave_linge: "Électroménager",
    seche_linge: "Électroménager",
    refrigerateur: "Électroménager",
    frigo: "Électroménager",
    four: "Électroménager",
    micro_onde: "Électroménager",
    aspirateur: "Électroménager",
    lampe: "Éclairage",
    lumiere: "Éclairage",
    light: "Éclairage",
    eclairage: "Éclairage",
    led: "Éclairage",
    voiture: "Véhicule",
    volet: "Volets",
    shutter: "Volets",
    prise: "Prises",
    plug: "Prises",
  };

  // ---------------------------------------------------------------------------
  // UI state (collapse, filtres)
  // ---------------------------------------------------------------------------

  const _collapsed_rooms = new Map();
  const _collapsed_types = new Map();
  const _collapsed_room_families = new Map();
  const _collapsed_type_families = new Map();
  let _rooms_filter = "";
  let _types_filter = "";
  let _rooms_sort_asc = true;
  let _types_sort_asc = true;
  let _show_types_energy = false;

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  function _as_list(v) {
    return Array.isArray(v) ? v : [];
  }

  function _keys_sorted(obj) {
    try { return Object.keys(obj || {}).sort(); } catch (_) { return []; }
  }

  function _fmt_ts(ts) {
    if (!ts) return null;
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return String(ts);
      return d.toLocaleString();
    } catch (_) { return String(ts); }
  }

  function _mk_btn(label, cls, cb) {
    const b = document.createElement("button");
    b.className = cls || "hse_button";
    b.textContent = label;
    b.addEventListener("click", cb);
    return b;
  }

  function _mk_input(placeholder, value, cls) {
    const i = document.createElement("input");
    i.className = cls || "hse_input";
    i.placeholder = placeholder || "";
    i.value = value || "";
    return i;
  }

  function _mk_select(options, value, cls) {
    // options: [{value, label}]
    const s = document.createElement("select");
    s.className = cls || "hse_input";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      s.appendChild(opt);
    }
    s.value = value || "";
    return s;
  }

  // ---------------------------------------------------------------------------
  // Détection famille (portée depuis V1 groupsPanel/typesPanel)
  // ---------------------------------------------------------------------------

  function _family_base(entity_id, kind) {
    if (!entity_id) return "";
    let base = entity_id.trim();
    if (kind === "energy") {
      base = base.replace(/_today_energy$/i, "");
      base = base.replace(/_energy_(hourly|daily|weekly|monthly|yearly)$/i, "");
      base = base.replace(/_energy$/i, "");
    } else {
      base = base.replace(/_power_energy_(hourly|daily|weekly|monthly|yearly)$/i, "");
      base = base.replace(/_power_energy$/i, "");
      base = base.replace(/_power$/i, "");
    }
    return base;
  }

  function _pick_parent(kind, items) {
    if (!items || items.length === 0) return null;
    if (kind === "energy") {
      const t = items.find((id) => /_today_energy$/i.test(id));
      if (t) return t;
      const p = items.find((id) => /_energy$/i.test(id));
      if (p) return p;
    } else {
      const p = items.find((id) => /_power$/i.test(id));
      if (p) return p;
      const pe = items.find((id) => /_power_energy$/i.test(id));
      if (pe) return pe;
    }
    return [...items].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  function _build_families(list, kind, sort_asc) {
    const by_base = new Map();
    (list || []).forEach((eid) => {
      const base = _family_base(eid, kind);
      if (!by_base.has(base)) by_base.set(base, []);
      by_base.get(base).push(eid);
    });
    const families = [];
    by_base.forEach((items, base) => {
      const parent = _pick_parent(kind, items);
      const children = items.filter((x) => x !== parent).sort((a, b) => a.localeCompare(b));
      families.push({
        key: base || parent || (items[0] || ""),
        parent,
        children,
        all: items.sort((a, b) => a.localeCompare(b)),
      });
    });
    families.sort((a, b) => {
      const ka = a.key || a.parent || "";
      const kb = b.key || b.parent || "";
      return sort_asc ? ka.localeCompare(kb) : kb.localeCompare(ka);
    });
    return families;
  }

  // Construit un index base→[energy_ids] depuis tous les assignments
  function _build_energy_index(assignments) {
    const idx = new Map();
    Object.entries(assignments || {}).forEach(([eid, a]) => {
      if (!a) return;
      const base = _family_base(eid, "energy");
      if (!idx.has(base)) idx.set(base, []);
      idx.get(base).push(eid);
    });
    return idx;
  }

  function _link_energy_for_power(power_eid, energy_index) {
    const base = _family_base(power_eid, "power");
    const candidates = energy_index.get(base) || [];
    if (!candidates.length) return null;
    return _pick_parent("energy", candidates);
  }

  // ---------------------------------------------------------------------------
  // Modal déplacement (rooms)
  // ---------------------------------------------------------------------------

  function _open_move_modal(entity_ids, current_room_id, rooms, on_action, on_done) {
    const overlay = el("div", "hse_modal_overlay");
    const modal = el("div", "hse_modal");

    const header = el("div", "hse_modal_header");
    const title_el = el("div", "hse_modal_title",
      entity_ids.length > 1
        ? `Déplacer ${entity_ids.length} capteur(s) vers…`
        : `Déplacer ${entity_ids[0]}`
    );
    const close_btn = _mk_btn("×", "hse_modal_close", () => document.body.removeChild(overlay));
    header.appendChild(title_el);
    header.appendChild(close_btn);

    const body = el("div", "hse_modal_body");

    const room_opts = _keys_sorted(rooms).map((rid) => ({
      value: rid,
      label: rooms[rid]?.name ? `${rooms[rid].name} (${rid})` : rid,
    }));

    const sel = _mk_select(room_opts, current_room_id || "", "hse_input");
    sel.style.width = "100%";
    sel.style.marginBottom = "10px";
    body.appendChild(sel);

    const or_label = el("div", "hse_subtitle", "Ou créer une nouvelle pièce :");
    body.appendChild(or_label);

    const new_input = _mk_input("Nom de la nouvelle pièce", "", "hse_input");
    new_input.style.width = "100%";
    body.appendChild(new_input);

    const footer = el("div", "hse_modal_footer");

    const cancel_btn = _mk_btn("Annuler", "hse_button", () => document.body.removeChild(overlay));

    const confirm_btn = _mk_btn("Déplacer", "hse_button hse_button_primary", () => {
      let target_room = new_input.value.trim();
      if (!target_room) target_room = sel.value;
      if (!target_room) { document.body.removeChild(overlay); return; }

      entity_ids.forEach((eid) => {
        on_action("org_patch", { path: `assignments.${eid}.room_id`, value: target_room });
      });

      document.body.removeChild(overlay);
      if (on_done) on_done(target_room);
    });

    footer.appendChild(cancel_btn);
    footer.appendChild(confirm_btn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------------------------
  // Modal assignation type
  // ---------------------------------------------------------------------------

  function _open_type_modal(entity_ids, current_type_id, known_types, on_action, on_done) {
    const overlay = el("div", "hse_modal_overlay");
    const modal = el("div", "hse_modal");

    const header = el("div", "hse_modal_header");
    const title_el = el("div", "hse_modal_title",
      entity_ids.length > 1
        ? `Affecter ${entity_ids.length} capteur(s) à un type…`
        : `Affecter ${entity_ids[0]}`
    );
    const close_btn = _mk_btn("×", "hse_modal_close", () => document.body.removeChild(overlay));
    header.appendChild(title_el);
    header.appendChild(close_btn);

    const body = el("div", "hse_modal_body");

    const type_opts = [...known_types].sort().map((t) => ({ value: t, label: t }));
    const sel = _mk_select(type_opts, current_type_id || "", "hse_input");
    sel.style.width = "100%";
    sel.style.marginBottom = "10px";
    body.appendChild(sel);

    const or_label = el("div", "hse_subtitle", "Ou créer un nouveau type :");
    body.appendChild(or_label);

    const new_input = _mk_input("Nom du nouveau type (ex: TV, Chauffage…)", "", "hse_input");
    new_input.style.width = "100%";
    body.appendChild(new_input);

    const footer = el("div", "hse_modal_footer");
    const cancel_btn = _mk_btn("Annuler", "hse_button", () => document.body.removeChild(overlay));
    const confirm_btn = _mk_btn("Valider", "hse_button hse_button_primary", () => {
      let target_type = new_input.value.trim();
      if (!target_type) target_type = sel.value;

      entity_ids.forEach((eid) => {
        on_action("org_patch", { path: `assignments.${eid}.type_id`, value: target_type || null });
      });

      document.body.removeChild(overlay);
      if (on_done) on_done(target_type);
    });

    footer.appendChild(cancel_btn);
    footer.appendChild(confirm_btn);
    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ---------------------------------------------------------------------------
  // Rendu famille (ligne capteur cliquable)
  // ---------------------------------------------------------------------------

  function _render_family_row(fam, kind, collapsed_map, collapsed_key, on_click_parent, on_click_child, redraw_fn) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "4px";

    const is_collapsed = collapsed_map.get(collapsed_key) === true;

    const parent_row = el("div", "hse_sensor_row hse_sensor_clickable");
    parent_row.title = "Cliquer pour déplacer toute cette famille";

    const caret = document.createElement("span");
    caret.className = "hse_sensor_caret";
    caret.textContent = fam.children.length > 0 ? (is_collapsed ? "▶" : "▼") : "•";
    caret.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (fam.children.length === 0) return;
      collapsed_map.set(collapsed_key, !is_collapsed);
      redraw_fn();
    });

    const label = document.createElement("span");
    label.className = "hse_sensor_label";
    label.textContent = fam.parent || fam.all[0];

    parent_row.appendChild(caret);
    parent_row.appendChild(label);
    parent_row.addEventListener("click", () => on_click_parent(fam));
    wrapper.appendChild(parent_row);

    if (!is_collapsed && fam.children.length > 0) {
      const children_box = document.createElement("div");
      children_box.className = "hse_sensor_children";
      fam.children.forEach((eid) => {
        const row = el("div", "hse_sensor_row hse_sensor_clickable hse_sensor_child");
        row.textContent = eid;
        row.title = "Cliquer pour déplacer ce capteur seul";
        row.addEventListener("click", () => on_click_child(eid));
        children_box.appendChild(row);
      });
      wrapper.appendChild(children_box);
    }

    return wrapper;
  }

  // ---------------------------------------------------------------------------
  // Rendu colonne capteurs (energy ou power)
  // ---------------------------------------------------------------------------

  function _render_sensor_column(key, title, kind, entity_ids, filter_q, collapsed_families_map, on_click_family, on_click_single, redraw_fn) {
    const col = el("div", "hse_sensor_col");
    col.appendChild(el("div", "hse_sensor_col_title", title));

    let filtered = (entity_ids || []);
    if (filter_q) {
      const q = filter_q.toLowerCase();
      filtered = filtered.filter((s) => s.toLowerCase().includes(q));
    }

    const families = _build_families(filtered, kind, true);
    const list = el("div", "hse_sensor_list");

    if (families.length === 0) {
      list.appendChild(el("div", "hse_sensor_empty", `Aucun capteur.`));
    } else {
      families.forEach((fam) => {
        const fam_key = `${key}:${kind}:${fam.key}`;
        const row = _render_family_row(
          fam, kind,
          collapsed_families_map, fam_key,
          (f) => on_click_family(f, kind),
          (eid) => on_click_single(eid, kind),
          redraw_fn
        );
        list.appendChild(row);
      });
    }

    col.appendChild(list);
    return col;
  }

  // ---------------------------------------------------------------------------
  // Section ROOMS — cartes collapsibles par pièce
  // ---------------------------------------------------------------------------

  function _render_rooms_section(container, rooms, assignments, on_action, redraw_fn) {
    clear(container);

    // Header barre
    const headerbar = el("div", "hse_groups_headerbar");
    headerbar.appendChild(el("div", "hse_groups_title", "Pièces & capteurs"));

    const spacer = el("div", "hse_groups_spacer");
    headerbar.appendChild(spacer);

    const filter_input = _mk_input("Filtrer les pièces ou capteurs…", _rooms_filter, "hse_input hse_groups_filter");
    filter_input.addEventListener("input", (ev) => {
      _rooms_filter = ev.target.value || "";
      _render_rooms_section(container, rooms, assignments, on_action, redraw_fn);
    });
    headerbar.appendChild(filter_input);

    const sort_btn = _mk_btn(
      _rooms_sort_asc ? "Tri A→Z" : "Tri Z→A",
      "hse_button",
      () => {
        _rooms_sort_asc = !_rooms_sort_asc;
        _render_rooms_section(container, rooms, assignments, on_action, redraw_fn);
      }
    );
    headerbar.appendChild(sort_btn);

    const add_btn = _mk_btn("+ Ajouter une pièce", "hse_button", () => {
      const name = window.prompt("Nom de la nouvelle pièce :");
      if (!name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const def_id = trimmed.toLowerCase().replaceAll(" ", "_").replaceAll(/[^a-z0-9_\-]/g, "").slice(0, 60);
      const room_id = window.prompt("room_id ?", def_id);
      if (!room_id) return;
      on_action("org_room_add", { room_id: room_id.trim(), name: trimmed });
    });
    headerbar.appendChild(add_btn);

    const refresh_btn = _mk_btn("Rafraîchir", "hse_button", () => on_action("org_refresh"));
    headerbar.appendChild(refresh_btn);

    const preview_btn = _mk_btn("Prévisualiser", "hse_button hse_button_primary", () => on_action("org_preview"));
    headerbar.appendChild(preview_btn);

    const save_btn = _mk_btn("Sauvegarder", "hse_button", () => on_action("org_save"));
    headerbar.appendChild(save_btn);

    container.appendChild(headerbar);

    // Barre bulk par mot-clé
    const bulkbar = el("div", "hse_groups_bulkbar");
    bulkbar.appendChild(el("span", "hse_groups_bulk_label", "Déplacement en masse :"));

    const kw_input = _mk_input("Mot-clé (ex: emma)…", "", "hse_input hse_groups_keyword");
    bulkbar.appendChild(kw_input);

    bulkbar.appendChild(el("span", "hse_groups_bulk_label", "vers la pièce :"));

    const room_opts_bulk = _keys_sorted(rooms).map((rid) => ({
      value: rid,
      label: rooms[rid]?.name ? `${rooms[rid].name} (${rid})` : rid,
    }));
    const target_sel = _mk_select(room_opts_bulk, "", "hse_input hse_groups_select");
    bulkbar.appendChild(target_sel);

    const bulk_btn = _mk_btn("Déplacer en masse", "hse_button hse_button_primary", () => {
      const kw = kw_input.value.trim().toLowerCase();
      if (!kw) { alert("Veuillez saisir un mot-clé."); return; }
      const target_room = target_sel.value;
      if (!target_room) { alert("Veuillez choisir une pièce cible."); return; }

      let count = 0;
      Object.keys(assignments || {}).forEach((eid) => {
        if (eid.toLowerCase().includes(kw)) {
          on_action("org_patch", { path: `assignments.${eid}.room_id`, value: target_room });
          count++;
        }
      });
      if (count > 0) {
        kw_input.value = "";
      } else {
        alert(`Aucun capteur ne contient "${kw}".`);
      }
    });
    bulkbar.appendChild(bulk_btn);
    container.appendChild(bulkbar);

    // Construire index capteurs par room
    const entities_by_room = {};
    Object.entries(assignments || {}).forEach(([eid, a]) => {
      const rid = a?.room_id || "__none__";
      if (!entities_by_room[rid]) entities_by_room[rid] = [];
      entities_by_room[rid].push(eid);
    });

    // Trier les rooms
    const room_keys = _keys_sorted(rooms);
    const sorted_rooms = _rooms_sort_asc ? room_keys : [...room_keys].reverse();

    // Pièce "Non affecté" si des capteurs n'ont pas de room
    const unassigned = entities_by_room["__none__"] || [];

    const list_container = el("div", "hse_groups_container");

    const render_room_card = (room_id, room_cfg, entity_ids_for_room) => {
      const name = room_cfg?.name || room_id;

      // Filtre global
      if (_rooms_filter) {
        const q = _rooms_filter.toLowerCase();
        const room_match = room_id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
        const has_entity_match = (entity_ids_for_room || []).some((eid) => eid.toLowerCase().includes(q));
        if (!room_match && !has_entity_match) return;
      }

      const is_collapsed = _collapsed_rooms.get(room_id) === true;
      const eids = entity_ids_for_room || [];

      // Sépare energy / power
      const energy_eids = eids.filter((eid) => {
        const e = eid.toLowerCase();
        return e.includes("_energy") || e.endsWith("_kwh") || e.includes("_consumption");
      });
      const power_eids = eids.filter((eid) => {
        const e = eid.toLowerCase();
        return e.includes("_power") && !e.includes("_power_energy");
      });
      // Reste (ni energy ni power classifiables)
      const other_eids = eids.filter((eid) => !energy_eids.includes(eid) && !power_eids.includes(eid));
      // Merge power+other pour colonne principale
      const main_eids = [...power_eids, ...other_eids];

      const card = el("div", "hse_group_card");

      const header = el("div", "hse_group_header");

      const toggle_btn = _mk_btn(is_collapsed ? "▶" : "▼", "hse_group_toggle", () => {
        _collapsed_rooms.set(room_id, !is_collapsed);
        _render_rooms_section(container, rooms, assignments, on_action, redraw_fn);
      });
      header.appendChild(toggle_btn);

      const title_wrap = el("div", "hse_group_title");
      title_wrap.appendChild(el("span", "hse_group_icon", "🏠"));
      title_wrap.appendChild(el("span", "hse_group_name_label", name));
      title_wrap.appendChild(el("span", "hse_groups_toolbar_info", ` — ${eids.length} capteur(s)`));
      header.appendChild(title_wrap);

      // Bouton renommer
      const rename_btn = _mk_btn("✏️", "hse_group_toggle", () => {
        const new_name = window.prompt("Nouveau nom de la pièce :", name);
        if (!new_name || new_name.trim() === name) return;
        on_action("org_patch", { path: `rooms.${room_id}.name`, value: new_name.trim() });
      });
      rename_btn.title = "Renommer";
      header.appendChild(rename_btn);

      // Bouton supprimer
      const del_btn = _mk_btn("🗑️", "hse_group_toggle", () => {
        if (!window.confirm(`Supprimer la pièce "${name}" ?`)) return;
        on_action("org_room_delete", { room_id });
      });
      del_btn.title = "Supprimer cette pièce";
      header.appendChild(del_btn);

      card.appendChild(header);

      // Corps
      const body = el("div", "hse_group_body");
      if (is_collapsed) body.style.display = "none";

      const redraw_room = () => _render_rooms_section(container, rooms, assignments, on_action, redraw_fn);

      const on_click_family = (fam, kind) => {
        _open_move_modal(fam.all, room_id, rooms, on_action, () => redraw_room());
      };
      const on_click_single = (eid, kind) => {
        _open_move_modal([eid], room_id, rooms, on_action, () => redraw_room());
      };

      if (main_eids.length > 0) {
        body.appendChild(_render_sensor_column(
          room_id, "Capteurs power / autres", "power", main_eids,
          _rooms_filter, _collapsed_room_families,
          on_click_family, on_click_single, redraw_room
        ));
      }
      if (energy_eids.length > 0) {
        body.appendChild(_render_sensor_column(
          room_id + ":e", "Capteurs energy", "energy", energy_eids,
          _rooms_filter, _collapsed_room_families,
          on_click_family, on_click_single, redraw_room
        ));
      }
      if (main_eids.length === 0 && energy_eids.length === 0) {
        body.appendChild(el("div", "hse_sensor_empty", "Aucun capteur affecté à cette pièce."));
      }

      card.appendChild(body);
      list_container.appendChild(card);
    };

    sorted_rooms.forEach((room_id) => {
      render_room_card(room_id, rooms[room_id], entities_by_room[room_id] || []);
    });

    // Carte "Non affectés"
    if (unassigned.length > 0) {
      const eid_match = _rooms_filter
        ? unassigned.filter((eid) => eid.toLowerCase().includes(_rooms_filter.toLowerCase()))
        : unassigned;

      if (eid_match.length > 0) {
        const is_collapsed = _collapsed_rooms.get("__none__") === true;
        const card = el("div", "hse_group_card hse_group_card_unassigned");
        const header = el("div", "hse_group_header");

        const toggle_btn = _mk_btn(is_collapsed ? "▶" : "▼", "hse_group_toggle", () => {
          _collapsed_rooms.set("__none__", !is_collapsed);
          _render_rooms_section(container, rooms, assignments, on_action, redraw_fn);
        });
        header.appendChild(toggle_btn);

        const title_wrap = el("div", "hse_group_title");
        title_wrap.appendChild(el("span", "hse_group_icon", "❓"));
        title_wrap.appendChild(el("span", "hse_group_name_label", "Non affectés"));
        title_wrap.appendChild(el("span", "hse_groups_toolbar_info", ` — ${eid_match.length} capteur(s)`));
        header.appendChild(title_wrap);
        card.appendChild(header);

        const body = el("div", "hse_group_body");
        if (is_collapsed) body.style.display = "none";

        const redraw_none = () => _render_rooms_section(container, rooms, assignments, on_action, redraw_fn);
        body.appendChild(_render_sensor_column(
          "__none__", "Capteurs sans pièce", "power", eid_match,
          "", _collapsed_room_families,
          (fam, kind) => _open_move_modal(fam.all, null, rooms, on_action, () => redraw_none()),
          (eid, kind) => _open_move_modal([eid], null, rooms, on_action, () => redraw_none()),
          redraw_none
        ));

        card.appendChild(body);
        list_container.appendChild(card);
      }
    }

    container.appendChild(list_container);
  }

  // ---------------------------------------------------------------------------
  // Section TYPES — cartes collapsibles par type
  // ---------------------------------------------------------------------------

  function _collect_known_types(assignments) {
    const types = new Set();
    Object.values(assignments || {}).forEach((a) => {
      if (a?.type_id) types.add(a.type_id);
    });
    return types;
  }

  function _render_types_section(container, assignments, on_action) {
    clear(container);

    const known_types = _collect_known_types(assignments);

    // Header barre
    const headerbar = el("div", "hse_groups_headerbar");
    headerbar.appendChild(el("div", "hse_groups_title", "Types (catégories)"));

    const spacer = el("div", "hse_groups_spacer");
    headerbar.appendChild(spacer);

    const filter_input = _mk_input("Filtrer types ou capteurs…", _types_filter, "hse_input hse_groups_filter");
    filter_input.addEventListener("input", (ev) => {
      _types_filter = ev.target.value || "";
      _render_types_section(container, assignments, on_action);
    });
    headerbar.appendChild(filter_input);

    const sort_btn = _mk_btn(
      _types_sort_asc ? "Tri A→Z" : "Tri Z→A",
      "hse_button",
      () => {
        _types_sort_asc = !_types_sort_asc;
        _render_types_section(container, assignments, on_action);
      }
    );
    headerbar.appendChild(sort_btn);

    const facture_btn = _mk_btn(
      _show_types_energy ? "Energy: ON" : "Energy: OFF",
      "hse_button",
      () => {
        _show_types_energy = !_show_types_energy;
        _render_types_section(container, assignments, on_action);
      }
    );
    facture_btn.title = "Afficher/masquer la colonne energy";
    headerbar.appendChild(facture_btn);

    const add_btn = _mk_btn("+ Ajouter un type", "hse_button", () => {
      const name = window.prompt("Nom du nouveau type :");
      if (!name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      // Ajoute une entrée vide pour créer le type visuellement
      on_action("org_type_create", { type_id: trimmed });
    });
    headerbar.appendChild(add_btn);

    // Bouton Auto types (depuis DEFAULT_TYPE_KEYWORDS)
    const auto_btn = _mk_btn("⚡ Auto types (mots-clés)", "hse_button hse_button_primary", () => {
      const energy_index = _build_energy_index(assignments);
      let count = 0;

      Object.entries(assignments || {}).forEach(([eid, a]) => {
        if (!a) return;
        const s = eid.toLowerCase();
        for (const [kw, type_name] of Object.entries(DEFAULT_TYPE_KEYWORDS)) {
          if (s.includes(kw.toLowerCase())) {
            if (!a.type_id) {
              on_action("org_patch", { path: `assignments.${eid}.type_id`, value: type_name });
              count++;

              // Auto-link energy correspondant
              const energy_eid = _link_energy_for_power(eid, energy_index);
              if (energy_eid && assignments[energy_eid] && !assignments[energy_eid].type_id) {
                on_action("org_patch", { path: `assignments.${energy_eid}.type_id`, value: type_name });
                count++;
              }
            }
            break;
          }
        }
      });

      alert(`Auto types : ${count} capteur(s) typé(s) automatiquement.`);
      _render_types_section(container, assignments, on_action);
    });
    auto_btn.title = "Détecte automatiquement les types depuis les mots-clés des entity_id";
    headerbar.appendChild(auto_btn);

    container.appendChild(headerbar);

    // Barre bulk par mot-clé
    const bulkbar = el("div", "hse_groups_bulkbar");
    bulkbar.appendChild(el("span", "hse_groups_bulk_label", "Affecter en masse :"));

    const kw_input = _mk_input("Mot-clé (ex: tv)…", "", "hse_input hse_groups_keyword");
    bulkbar.appendChild(kw_input);

    bulkbar.appendChild(el("span", "hse_groups_bulk_label", "→ type :"));

    const all_types_bulk = [...known_types].sort().map((t) => ({ value: t, label: t }));
    if (all_types_bulk.length === 0) all_types_bulk.push({ value: "", label: "(aucun type défini)" });
    const target_sel = _mk_select(all_types_bulk, "", "hse_input hse_groups_select");
    bulkbar.appendChild(target_sel);

    const new_type_input = _mk_input("ou nouveau type…", "", "hse_input hse_groups_keyword");
    bulkbar.appendChild(new_type_input);

    const bulk_btn = _mk_btn("Appliquer", "hse_button hse_button_primary", () => {
      const kw = kw_input.value.trim().toLowerCase();
      if (!kw) { alert("Veuillez saisir un mot-clé."); return; }
      let target_type = new_type_input.value.trim() || target_sel.value;
      if (!target_type) { alert("Veuillez choisir ou saisir un type cible."); return; }

      let count = 0;
      Object.keys(assignments || {}).forEach((eid) => {
        if (eid.toLowerCase().includes(kw)) {
          on_action("org_patch", { path: `assignments.${eid}.type_id`, value: target_type });
          count++;
        }
      });
      if (count === 0) alert(`Aucun capteur ne contient "${kw}".`);
      else { kw_input.value = ""; new_type_input.value = ""; }
    });
    bulkbar.appendChild(bulk_btn);
    container.appendChild(bulkbar);

    // Index capteurs par type
    const entities_by_type = {};
    Object.entries(assignments || {}).forEach(([eid, a]) => {
      const tid = a?.type_id || "__none__";
      if (!entities_by_type[tid]) entities_by_type[tid] = [];
      entities_by_type[tid].push(eid);
    });

    const type_keys = [...known_types];
    const sorted_types = _types_sort_asc ? type_keys.sort() : type_keys.sort().reverse();

    const list_container = el("div", "hse_groups_container");

    sorted_types.forEach((type_id) => {
      const eids = entities_by_type[type_id] || [];

      if (_types_filter) {
        const q = _types_filter.toLowerCase();
        const type_match = type_id.toLowerCase().includes(q);
        const has_match = eids.some((eid) => eid.toLowerCase().includes(q));
        if (!type_match && !has_match) return;
      }

      const is_collapsed = _collapsed_types.get(type_id) === true;

      const power_eids = eids.filter((eid) => {
        const e = eid.toLowerCase();
        return !e.includes("_energy") && !e.endsWith("_kwh");
      });
      const energy_eids = eids.filter((eid) => !power_eids.includes(eid));

      const card = el("div", "hse_group_card");
      const header = el("div", "hse_group_header");

      const toggle_btn = _mk_btn(is_collapsed ? "▶" : "▼", "hse_group_toggle", () => {
        _collapsed_types.set(type_id, !is_collapsed);
        _render_types_section(container, assignments, on_action);
      });
      header.appendChild(toggle_btn);

      const title_wrap = el("div", "hse_group_title");
      title_wrap.appendChild(el("span", "hse_group_icon", "🏷️"));
      title_wrap.appendChild(el("span", "hse_group_name_label", type_id));
      title_wrap.appendChild(el("span", "hse_groups_toolbar_info", ` — ${eids.length} capteur(s)`));
      header.appendChild(title_wrap);

      const del_btn = _mk_btn("🗑️", "hse_group_toggle", () => {
        if (!window.confirm(`Retirer le type "${type_id}" de tous les capteurs ?`)) return;
        (entities_by_type[type_id] || []).forEach((eid) => {
          on_action("org_patch", { path: `assignments.${eid}.type_id`, value: null });
        });
        _render_types_section(container, assignments, on_action);
      });
      del_btn.title = "Retirer ce type de tous les capteurs";
      header.appendChild(del_btn);

      card.appendChild(header);

      const body = el("div", "hse_group_body");
      if (is_collapsed) body.style.display = "none";

      const redraw_types = () => _render_types_section(container, assignments, on_action);

      const on_family_click = (fam, kind) => {
        _open_type_modal(fam.all, type_id, known_types, on_action, () => redraw_types());
      };
      const on_single_click = (eid, kind) => {
        _open_type_modal([eid], type_id, known_types, on_action, () => redraw_types());
      };

      body.appendChild(_render_sensor_column(
        type_id, "Capteurs power", "power", power_eids,
        _types_filter, _collapsed_type_families,
        on_family_click, on_single_click, redraw_types
      ));

      if (_show_types_energy && energy_eids.length > 0) {
        body.appendChild(_render_sensor_column(
          type_id + ":e", "Capteurs energy", "energy", energy_eids,
          _types_filter, _collapsed_type_families,
          on_family_click, on_single_click, redraw_types
        ));
      }

      card.appendChild(body);
      list_container.appendChild(card);
    });

    // Carte "Non typés"
    const untyped = entities_by_type["__none__"] || [];
    if (untyped.length > 0) {
      const q = _types_filter.toLowerCase();
      const visible = q ? untyped.filter((eid) => eid.toLowerCase().includes(q)) : untyped;
      if (visible.length > 0) {
        const is_collapsed = _collapsed_types.get("__none__") === true;
        const card = el("div", "hse_group_card hse_group_card_unassigned");
        const header = el("div", "hse_group_header");

        const toggle_btn = _mk_btn(is_collapsed ? "▶" : "▼", "hse_group_toggle", () => {
          _collapsed_types.set("__none__", !is_collapsed);
          _render_types_section(container, assignments, on_action);
        });
        header.appendChild(toggle_btn);

        const title_wrap = el("div", "hse_group_title");
        title_wrap.appendChild(el("span", "hse_group_icon", "❓"));
        title_wrap.appendChild(el("span", "hse_group_name_label", "Sans type"));
        title_wrap.appendChild(el("span", "hse_groups_toolbar_info", ` — ${visible.length} capteur(s)`));
        header.appendChild(title_wrap);
        card.appendChild(header);

        const body = el("div", "hse_group_body");
        if (is_collapsed) body.style.display = "none";

        const redraw_none = () => _render_types_section(container, assignments, on_action);
        body.appendChild(_render_sensor_column(
          "__none__:type", "Capteurs non typés", "power", visible,
          "", _collapsed_type_families,
          (fam) => _open_type_modal(fam.all, null, known_types, on_action, () => redraw_none()),
          (eid) => _open_type_modal([eid], null, known_types, on_action, () => redraw_none()),
          redraw_none
        ));

        card.appendChild(body);
        list_container.appendChild(card);
      }
    }

    container.appendChild(list_container);
  }

  // ---------------------------------------------------------------------------
  // Tables diff (Prévisualisation sync HA)
  // ---------------------------------------------------------------------------

  function _render_sync_tables(card, pending) {
    const rooms = pending?.rooms || {};
    const assignments = pending?.assignments || {};

    const create_rooms = _as_list(rooms.create);
    const rename_rooms = _as_list(rooms.rename);
    const suggest_room = _as_list(assignments.suggest_room);

    const add_table = (title, headers, rows) => {
      card.appendChild(el("div", "hse_subtitle", title));
      if (!rows.length) { card.appendChild(el("div", "hse_subtitle", "—")); return; }

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

    add_table("Créations de pièces", ["Nom", "room_id", "ha_area_id"],
      create_rooms.map((x) => [x?.name, x?.room_id, x?.ha_area_id]));
    add_table("Renommages de pièces", ["room_id", "De", "Vers", "Eligible (auto)"],
      rename_rooms.map((x) => [x?.room_id, x?.from, x?.to, x?.eligible ? "oui" : "non"]));
    add_table("Suggestions d'affectation (pièce)", ["entity_id", "De", "Vers", "Raison"],
      suggest_room.map((x) => [x?.entity_id, x?.from_room_id || "—", x?.to_room_id, x?.reason || "—"]));
  }

  // ---------------------------------------------------------------------------
  // Entrée principale
  // ---------------------------------------------------------------------------

  function render_customisation(container, state, org_state, on_action) {
    clear(container);

    const meta_store = org_state?.meta_store || null;
    const draft = org_state?.meta_draft || null;
    const rooms = draft?.rooms || meta_store?.meta?.rooms || {};
    const assignments = draft?.assignments || meta_store?.meta?.assignments || {};
    const sync = meta_store?.sync || null;
    const pending = sync?.pending_diff || null;
    const has_pending = !!(pending && pending.has_changes);

    // --- Apparence
    const theme_card = el("div", "hse_card");
    theme_card.appendChild(el("div", null, "Apparence & Thème"));
    theme_card.appendChild(el("div", "hse_subtitle", "Le thème s'applique à tous les onglets du panel (stocké dans ce navigateur)."));

    const theme_row = el("div", "hse_toolbar");

    const theme_sel = _mk_select(
      THEMES.map((t) => ({ value: t.key, label: t.label })),
      state?.theme || "ha",
      "hse_input"
    );
    theme_sel.style.minWidth = "220px";
    theme_sel.addEventListener("change", (ev) => on_action("set_theme", ev.target.value));
    theme_row.appendChild(theme_sel);
    theme_card.appendChild(theme_row);

    const toggles = el("div", "hse_badges");
    const btn_bg = _mk_btn(state?.dynamic_bg ? "Fond: ON" : "Fond: OFF", "hse_button",
      () => on_action("toggle_dynamic_bg"));
    toggles.appendChild(btn_bg);
    const btn_glass = _mk_btn(state?.glass ? "Glass: ON" : "Glass: OFF", "hse_button",
      () => on_action("toggle_glass"));
    toggles.appendChild(btn_glass);
    theme_card.appendChild(toggles);
    container.appendChild(theme_card);

    // --- Sync HA (résumé + diff)
    const org = el("div", "hse_card");
    org.appendChild(el("div", null, "Sync Home Assistant"));
    org.appendChild(el("div", "hse_subtitle",
      "Prévisualise puis applique des propositions (pièces/affectations) à partir des zones Home Assistant."));

    if (sync?.last_error) org.appendChild(el("pre", "hse_code", String(sync.last_error)));

    const summary = [];
    if (has_pending) {
      const stats = pending?.stats || {};
      summary.push(`Pièces: +${stats?.create_rooms ?? 0}`);
      summary.push(`renommages: ${stats?.rename_rooms ?? 0}`);
      summary.push(`suggestions: ${stats?.suggest_room ?? 0}`);
    } else {
      summary.push("Aucune proposition en attente.");
    }
    if (sync?.pending_generated_at) {
      const ts = _fmt_ts(sync.pending_generated_at);
      if (ts) summary.push(`Généré: ${ts}`);
    }
    if (org_state?.dirty) summary.push("⚠ Brouillon modifié (non sauvegardé)");

    org.appendChild(el("div", "hse_subtitle", summary.join(", ")));

    const tb = el("div", "hse_toolbar");
    const btn_apply_auto = _mk_btn("Appliquer (auto)", "hse_button",
      () => on_action("org_apply", { apply_mode: "auto" }));
    btn_apply_auto.disabled = !has_pending || !!org_state?.apply_running;
    tb.appendChild(btn_apply_auto);

    const btn_apply_all = _mk_btn("Appliquer (all)", "hse_button",
      () => on_action("org_apply", { apply_mode: "all" }));
    btn_apply_all.disabled = !has_pending || !!org_state?.apply_running;
    tb.appendChild(btn_apply_all);

    const btn_raw = _mk_btn(org_state?.show_raw ? "Debug: ON" : "Debug: OFF", "hse_button",
      () => on_action("org_toggle_raw"));
    tb.appendChild(btn_raw);

    org.appendChild(tb);

    if (org_state?.message) org.appendChild(el("div", "hse_subtitle", String(org_state.message)));
    if (org_state?.error) org.appendChild(el("pre", "hse_code", String(org_state.error)));

    if (has_pending) _render_sync_tables(org, pending);

    if (org_state?.show_raw) {
      org.appendChild(el("div", "hse_subtitle", "Données brutes"));
      org.appendChild(el("pre", "hse_code", JSON.stringify({ meta_store, meta_draft: org_state?.meta_draft || null }, null, 2)));
    }

    container.appendChild(org);

    // --- Rooms (cartes collapsibles V1-style)
    const rooms_card = el("div", "hse_card");
    const rooms_section = el("div");
    rooms_card.appendChild(rooms_section);
    container.appendChild(rooms_card);
    _render_rooms_section(rooms_section, rooms, assignments, on_action,
      () => _render_rooms_section(rooms_section, rooms, assignments, on_action, null));

    // --- Types (cartes collapsibles V1-style)
    const types_card = el("div", "hse_card");
    const types_section = el("div");
    types_card.appendChild(types_section);
    container.appendChild(types_card);
    _render_types_section(types_section, assignments, on_action);
  }

  window.hse_custom_view = { render_customisation };
})();
