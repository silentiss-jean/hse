(function () {
  const { el, clear } = window.hse_dom;

  // ---------------------------------------------------------------------------
  // Constantes
  // ---------------------------------------------------------------------------

  const THEMES = [
    { key: "ha",      label: "Home Assistant (thème HA)" },
    { key: "dark",    label: "Dark (sobre)" },
    { key: "light",   label: "Light" },
    { key: "ocean",   label: "Ocean" },
    { key: "forest",  label: "Forest" },
    { key: "sunset",  label: "Sunset" },
    { key: "minimal", label: "Minimal" },
    { key: "neon",    label: "Neon" },
    { key: "aurora",  label: "Aurora (glass)" },
    { key: "neuro",   label: "Neuro (soft light)" },
  ];

  const DEFAULT_ROOM_KEYWORDS = {
    salon:          "ha_living_room",
    living:         "ha_living_room",
    cuisine:        "ha_kitchen",
    kitchen:        "ha_kitchen",
    chambre:        "ha_bedroom",
    bedroom:        "ha_bedroom",
    bureau:         "ha_bureau",
    office:         "ha_bureau",
    buanderie:      "ha_buanderie",
    laundry:        "ha_buanderie",
    datac:          "ha_datac",
    serveur:        "ha_datac",
    server:         "ha_datac",
    emma:           "ha_chambre_d_emma",
    alex:           "ha_chambre_d_alex",
    sonos_beam:     "ha_sonos_beam",
    sonos_arc:      "ha_sonos_arc",
    appart2:        "ha_appartement_2",
    appartement_2:  "ha_appartement_2",
    appart1:        "ha_appartement_1",
    appartement_1:  "ha_appartement_1",
  };

  const DEFAULT_TYPE_KEYWORDS = {
    tv:             "TV",
    tele:           "TV",
    television:     "TV",
    chromecast:     "TV",
    apple_tv:       "TV",
    shield:         "TV",
    internet:       "Internet",
    box:            "Internet",
    routeur:        "Internet",
    router:         "Internet",
    freebox:        "Internet",
    livebox:        "Internet",
    nas:            "Informatique",
    pc:             "Informatique",
    ordi:           "Informatique",
    computer:       "Informatique",
    laptop:         "Informatique",
    chauffage:      "Chauffage",
    radiateur:      "Chauffage",
    clim:           "Chauffage",
    pac:            "Chauffage",
    thermor:        "Chauffage",
    atlantic:       "Chauffage",
    ecs:            "Eau chaude",
    ballon:         "Eau chaude",
    chauffe_eau:    "Eau chaude",
    cumulus:        "Eau chaude",
    lave_vaisselle: "Électroménager",
    lave_linge:     "Électroménager",
    seche_linge:    "Électroménager",
    refrigerateur:  "Électroménager",
    frigo:          "Électroménager",
    four:           "Électroménager",
    micro_onde:     "Électroménager",
    aspirateur:     "Électroménager",
    lampe:          "Éclairage",
    lumiere:        "Éclairage",
    light:          "Éclairage",
    eclairage:      "Éclairage",
    led:            "Éclairage",
    voiture:        "Véhicule",
    volet:          "Volets",
    shutter:        "Volets",
    prise:          "Prises",
    plug:           "Prises",
  };

  // ---------------------------------------------------------------------------
  // UI state — persistant entre renders
  // ---------------------------------------------------------------------------

  const _collapsed_rooms   = new Map();
  const _collapsed_types   = new Map();
  const _collapsed_rfam    = new Map();
  const _collapsed_tfam    = new Map();
  let _rooms_filter        = "";
  let _types_filter        = "";
  let _rooms_sort_asc      = true;
  let _types_sort_asc      = true;
  let _show_energy_col     = false;

  // État bulk persisté entre renders (évite reset sur filtre input)
  let _bulk_rooms_kw       = "";
  let _bulk_rooms_target   = "";
  let _bulk_types_kw       = "";
  let _bulk_types_target   = "";

  // ---------------------------------------------------------------------------
  // Normalisation backend
  // ---------------------------------------------------------------------------

  function _normalize_rooms(raw) {
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const out = {};
      raw.forEach((r) => { if (r && r.id) out[r.id] = r; });
      return out;
    }
    return raw;
  }

  function _hydrate_assignments(assignments_raw, rooms, snapshot_entities) {
    const out = {};
    Object.entries(assignments_raw || {}).forEach(([eid, a]) => {
      out[eid] = Object.assign({}, a);
    });

    const area_to_room = {};
    Object.entries(rooms).forEach(([rid, r]) => {
      if (r && r.ha_area_id) area_to_room[r.ha_area_id] = rid;
    });

    Object.values(snapshot_entities || {}).forEach((entity) => {
      const eid = entity && entity.entity_id;
      if (!eid || out[eid]) return;
      const room_id = entity.area_id ? (area_to_room[entity.area_id] || null) : null;
      out[eid] = { room_id, room_mode: "auto", type_id: null, type_mode: "mixed" };
    });

    return out;
  }

  // ---------------------------------------------------------------------------
  // Helpers DOM
  // ---------------------------------------------------------------------------

  function _btn(label, cls, cb) {
    const b = document.createElement("button");
    b.className = cls || "hse_button";
    b.textContent = label;
    b.addEventListener("click", cb);
    return b;
  }

  function _inp(placeholder, value, cls) {
    const i = document.createElement("input");
    i.className = cls || "hse_input";
    i.placeholder = placeholder || "";
    i.value = value || "";
    return i;
  }

  function _sel(options, value, cls) {
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

  function _keys_sorted(obj) {
    try { return Object.keys(obj || {}).sort(); } catch (_) { return []; }
  }

  function _fmt_ts(ts) {
    if (!ts) return null;
    try {
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
    } catch (_) { return String(ts); }
  }

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  function _inject_styles() {
    const id = "__hse_custom_styles_v3__";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
/* ─── Group card ─────────────────────────────────────────────────── */
.hse_gc {
  border: 1px solid var(--hse_border);
  border-radius: var(--hse-radius-md, 12px);
  margin-bottom: 4px;
  overflow: hidden;
  background: color-mix(in srgb, var(--hse_card_bg) 96%, var(--hse-bg) 4%);
  transition: box-shadow var(--hse-transition-fast, 120ms ease);
}
.hse_gc:hover { box-shadow: var(--hse-shadow-sm, 0 1px 3px rgba(0,0,0,.07)); }
.hse_gc_warn { border-color: color-mix(in srgb, var(--hse_danger,#ef4444) 35%, var(--hse_border) 65%); }

.hse_gh {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid transparent;
  min-height: 40px;
  transition: background var(--hse-transition-fast, 120ms ease),
              border-color var(--hse-transition-fast, 120ms ease);
}
.hse_gh:hover { background: color-mix(in srgb, var(--hse-hover, rgba(37,99,235,.08)) 70%, transparent); }
.hse_gc[data-open="1"] .hse_gh { border-bottom-color: var(--hse_border); }

.hse_gh_toggle {
  border: none; background: transparent;
  color: var(--hse_muted); font-size: 11px;
  cursor: pointer; padding: 2px 3px; line-height: 1; flex-shrink: 0;
}
.hse_gh_icon  { flex-shrink: 0; font-size: 15px; line-height: 1; }
.hse_gh_name  {
  font-size: 13px; font-weight: 700; color: var(--hse_fg);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  flex: 1 1 auto; min-width: 0;
}
.hse_gh_count {
  font-size: 11.5px; color: var(--hse_muted);
  white-space: nowrap; flex-shrink: 0;
}
.hse_gh_mode {
  font-size: 10px; padding: 2px 7px;
  border: 1px solid var(--hse_border);
  border-radius: 999px; color: var(--hse_muted);
  white-space: nowrap; flex-shrink: 0;
  background: color-mix(in srgb, var(--hse_card_bg) 80%, var(--hse-bg) 20%);
}

.hse_gh_actions { display: flex; align-items: center; gap: 1px; flex-shrink: 0; margin-left: 4px; }
.hse_gh_ab {
  border: none; background: transparent; cursor: pointer;
  padding: 3px 5px; border-radius: var(--hse-radius-sm, 8px);
  font-size: 13px; opacity: 0; line-height: 1;
  transition: opacity var(--hse-transition-fast,120ms ease), background var(--hse-transition-fast,120ms ease);
}
.hse_gh:hover .hse_gh_ab { opacity: .55; }
.hse_gh_ab:hover { opacity: 1 !important; background: color-mix(in srgb, var(--hse-hover,rgba(37,99,235,.08)) 90%, transparent); }
.hse_gh_ab.danger:hover { background: var(--hse-error-soft, rgba(239,68,68,.12)); }

.hse_gb {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding: 10px 12px;
}
@media (max-width: 700px) { .hse_gb { grid-template-columns: 1fr; } }

.hse_sc_col { min-width: 0; }
.hse_sc_col_title {
  font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .06em;
  color: var(--hse_muted); margin-bottom: 5px;
}
.hse_sc_list  { display: flex; flex-direction: column; gap: 1px; }
.hse_sc_empty { font-size: 12px; color: var(--hse_muted); font-style: italic; padding: 4px 0; }

.hse_sr {
  display: flex; align-items: center; gap: 5px;
  padding: 3px 6px; border-radius: var(--hse-radius-sm,8px);
  font-size: 12px; font-family: var(--hse-mono-font-family, ui-monospace);
  color: var(--hse_fg);
}
.hse_sr_click { cursor: pointer; transition: background var(--hse-transition-fast,120ms ease); }
.hse_sr_click:hover { background: color-mix(in srgb, var(--hse-hover,rgba(37,99,235,.08)) 80%, transparent); }
.hse_sr_child { margin-left: 14px; color: var(--hse_muted); font-size: 11.5px; }
.hse_sr_caret { flex-shrink:0; font-size:10px; color:var(--hse_muted); cursor:pointer; padding:0 2px; }
.hse_sr_label { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hse_sr_children { padding-left:4px; margin-top:1px; }

.hse_hbar {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 8px; margin-bottom: 8px;
}
.hse_hbar_title {
  font-size: 14px; font-weight: 800; color: var(--hse_fg);
  white-space: nowrap;
}
.hse_hbar_spacer { flex: 1 1 auto; }

.hse_bulkbar {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 8px; margin-bottom: 10px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--hse_card_bg) 88%, var(--hse-bg) 12%);
  border: 1px solid var(--hse_border);
  border-radius: var(--hse-radius-sm,8px);
  font-size: 12px; color: var(--hse_muted);
}
.hse_bulkbar_kw  { min-width:140px !important; max-width:200px; }
.hse_bulkbar_sel { min-width:160px !important; max-width:240px; }
.hse_bulkbar_inp { min-width:120px !important; max-width:180px; }
.hse_filter { min-width:180px !important; max-width:260px; }

.hse_groups { display: flex; flex-direction: column; gap: 2px; }

.hse_modal_ov {
  position:fixed; inset:0;
  background:rgba(0,0,0,.55); z-index:9999;
  display:flex; align-items:center; justify-content:center;
}
.hse_modal {
  background:var(--hse_card_bg); border:1px solid var(--hse_border);
  border-radius:var(--hse-radius-md,12px); overflow:hidden;
  min-width:320px; max-width:520px; width:90vw;
  box-shadow:var(--hse-shadow-md,0 10px 24px rgba(0,0,0,.12));
}
.hse_modal_hd {
  display:flex; align-items:center; justify-content:space-between;
  padding:12px 16px; border-bottom:1px solid var(--hse_border);
}
.hse_modal_title { font-size:14px; font-weight:700; }
.hse_modal_close {
  border:none; background:transparent; font-size:18px;
  cursor:pointer; color:var(--hse_muted); padding:0 4px; line-height:1;
}
.hse_modal_bd { padding:16px; }
.hse_modal_ft {
  display:flex; gap:8px; justify-content:flex-end;
  padding:10px 16px; border-top:1px solid var(--hse_border);
}
`;
    document.head.appendChild(s);
  }

  // ---------------------------------------------------------------------------
  // Familles
  // ---------------------------------------------------------------------------

  function _family_base(eid, kind) {
    let b = String(eid || "");
    if (kind === "energy") {
      b = b.replace(/_today_energy$/i, "")
           .replace(/_energy_(hourly|daily|weekly|monthly|yearly)$/i, "")
           .replace(/_energy$/i, "");
    } else {
      b = b.replace(/_power_energy_(hourly|daily|weekly|monthly|yearly)$/i, "")
           .replace(/_power_energy$/i, "")
           .replace(/_power$/i, "");
    }
    return b;
  }

  function _pick_parent(kind, items) {
    if (!items || !items.length) return null;
    if (kind === "energy") {
      return items.find((id) => /_today_energy$/i.test(id))
          || items.find((id) => /_energy$/i.test(id))
          || [...items].sort((a, b) => a.length - b.length)[0];
    }
    return items.find((id) => /_power$/i.test(id))
        || items.find((id) => /_power_energy$/i.test(id))
        || [...items].sort((a, b) => a.length - b.length)[0];
  }

  function _build_families(list, kind) {
    const by_base = new Map();
    (list || []).forEach((eid) => {
      const base = _family_base(eid, kind);
      if (!by_base.has(base)) by_base.set(base, []);
      by_base.get(base).push(eid);
    });
    const fams = [];
    by_base.forEach((items, base) => {
      const parent = _pick_parent(kind, items);
      const children = items.filter((x) => x !== parent).sort((a, b) => a.localeCompare(b));
      fams.push({ key: base || parent || items[0] || "", parent, children, all: [...items].sort((a,b)=>a.localeCompare(b)) });
    });
    return fams.sort((a, b) => (a.key || "").localeCompare(b.key || ""));
  }

  function _build_energy_index(assignments) {
    const idx = new Map();
    Object.keys(assignments || {}).forEach((eid) => {
      const base = _family_base(eid, "energy");
      if (!idx.has(base)) idx.set(base, []);
      idx.get(base).push(eid);
    });
    return idx;
  }

  // ---------------------------------------------------------------------------
  // Modal rooms
  // ---------------------------------------------------------------------------

  function _modal_move(entity_ids, current_room_id, rooms, on_action, redraw) {
    const ov = el("div", "hse_modal_ov");
    const m  = el("div", "hse_modal");
    const close = () => ov.remove();

    const hd = el("div", "hse_modal_hd");
    hd.appendChild(el("div", "hse_modal_title",
      entity_ids.length > 1 ? `Déplacer ${entity_ids.length} capteur(s)` : `Déplacer : ${entity_ids[0]}`));
    hd.appendChild(_btn("×", "hse_modal_close", close));

    const bd = el("div", "hse_modal_bd");
    const room_opts = _keys_sorted(rooms).map((rid) => ({
      value: rid,
      label: rooms[rid]?.name ? `${rooms[rid].name}` : rid,
    }));
    const sel = _sel(room_opts, current_room_id || "", "hse_input");
    sel.style.cssText = "width:100%;margin-bottom:10px;";
    bd.appendChild(el("div", "hse_subtitle", "Choisir une pièce existante :"));
    bd.appendChild(sel);
    bd.appendChild(el("div", "hse_subtitle", "— ou créer une nouvelle pièce :"));
    const new_inp = _inp("Nom de la nouvelle pièce", "", "hse_input");
    new_inp.style.cssText = "width:100%;margin-top:6px;";
    bd.appendChild(new_inp);

    const ft = el("div", "hse_modal_ft");
    ft.appendChild(_btn("Annuler", "hse_button", close));
    ft.appendChild(_btn("Déplacer", "hse_button hse_button_primary", () => {
      let target = new_inp.value.trim() || sel.value;
      if (!target) { close(); return; }
      entity_ids.forEach((eid) => {
        on_action("org_patch", { path: `assignments.${eid}.room_id`, value: target, no_render: true });
      });
      close();
      redraw();
    }));

    m.appendChild(hd); m.appendChild(bd); m.appendChild(ft);
    ov.appendChild(m);
    document.body.appendChild(ov);
  }

  // ---------------------------------------------------------------------------
  // Modal types
  // ---------------------------------------------------------------------------

  function _modal_type(entity_ids, current_type_id, known_types, on_action, redraw) {
    const ov = el("div", "hse_modal_ov");
    const m  = el("div", "hse_modal");
    const close = () => ov.remove();

    const hd = el("div", "hse_modal_hd");
    hd.appendChild(el("div", "hse_modal_title",
      entity_ids.length > 1 ? `Affecter ${entity_ids.length} capteur(s) à un type` : `Type : ${entity_ids[0]}`));
    hd.appendChild(_btn("×", "hse_modal_close", close));

    const bd = el("div", "hse_modal_bd");
    const type_opts = [...known_types].sort().map((t) => ({ value: t, label: t }));
    const sel = _sel(type_opts, current_type_id || "", "hse_input");
    sel.style.cssText = "width:100%;margin-bottom:10px;";
    bd.appendChild(el("div", "hse_subtitle", "Choisir un type existant :"));
    bd.appendChild(sel);
    bd.appendChild(el("div", "hse_subtitle", "— ou créer un nouveau type :"));
    const new_inp = _inp("Ex: TV, Chauffage…", "", "hse_input");
    new_inp.style.cssText = "width:100%;margin-top:6px;";
    bd.appendChild(new_inp);

    const ft = el("div", "hse_modal_ft");
    ft.appendChild(_btn("Annuler", "hse_button", close));
    ft.appendChild(_btn("Valider", "hse_button hse_button_primary", () => {
      let target = new_inp.value.trim() || sel.value;
      entity_ids.forEach((eid) => {
        on_action("org_patch", { path: `assignments.${eid}.type_id`, value: target || null, no_render: true });
      });
      close();
      redraw();
    }));

    m.appendChild(hd); m.appendChild(bd); m.appendChild(ft);
    ov.appendChild(m);
    document.body.appendChild(ov);
  }

  // ---------------------------------------------------------------------------
  // Colonne capteurs
  // ---------------------------------------------------------------------------

  function _render_sensor_col(key, title, kind, eids, filter_q, fam_map, on_fam, on_single, full_redraw) {
    const col = el("div", "hse_sc_col");
    col.appendChild(el("div", "hse_sc_col_title", title));

    let filtered = eids || [];
    if (filter_q) {
      const q = filter_q.toLowerCase();
      filtered = filtered.filter((s) => s.toLowerCase().includes(q));
    }

    const fams = _build_families(filtered, kind);
    const list = el("div", "hse_sc_list");

    if (!fams.length) {
      list.appendChild(el("div", "hse_sc_empty", "Aucun capteur."));
    } else {
      fams.forEach((fam) => {
        const fkey = `${key}:${kind}:${fam.key}`;
        const is_coll = fam_map.get(fkey) === true;

        const row = el("div", "hse_sr hse_sr_click");
        row.title = "Cliquer pour déplacer";

        if (fam.children.length) {
          const caret = el("span", "hse_sr_caret", is_coll ? "▶" : "▼");
          caret.addEventListener("click", (ev) => {
            ev.stopPropagation();
            fam_map.set(fkey, !is_coll);
            full_redraw();
          });
          row.appendChild(caret);
        } else {
          row.appendChild(el("span", "hse_sr_caret", "•"));
        }

        const lbl = el("span", "hse_sr_label", fam.parent || fam.all[0]);
        row.appendChild(lbl);
        row.addEventListener("click", () => on_fam(fam));
        list.appendChild(row);

        if (!is_coll && fam.children.length) {
          const cbox = el("div", "hse_sr_children");
          fam.children.forEach((eid) => {
            const cr = el("div", "hse_sr hse_sr_click hse_sr_child");
            cr.title = "Cliquer pour déplacer";
            cr.appendChild(el("span", "hse_sr_label", eid));
            cr.addEventListener("click", () => on_single(eid));
            cbox.appendChild(cr);
          });
          list.appendChild(cbox);
        }
      });
    }

    col.appendChild(list);
    return col;
  }

  // ---------------------------------------------------------------------------
  // _refresh_rooms_list — redessine uniquement list_ctn (pas header ni bulk)
  // ---------------------------------------------------------------------------

  function _refresh_rooms_list(list_ctn, rooms, assignments, on_action) {
    clear(list_ctn);

    const by_room = {};
    Object.entries(assignments || {}).forEach(([eid, a]) => {
      const rid = a?.room_id || "__none__";
      if (!by_room[rid]) by_room[rid] = [];
      by_room[rid].push(eid);
    });

    const sorted_room_keys = _rooms_sort_asc
      ? _keys_sorted(rooms)
      : _keys_sorted(rooms).reverse();

    // Carte Non affectés
    const unassigned = by_room["__none__"] || [];
    if (unassigned.length > 0) {
      const q = _rooms_filter.toLowerCase();
      const visible = q ? unassigned.filter((eid) => eid.toLowerCase().includes(q)) : unassigned;
      if (visible.length > 0) {
        if (!_collapsed_rooms.has("__none__")) _collapsed_rooms.set("__none__", false);
        const is_open = !_collapsed_rooms.get("__none__");

        const card = el("div", "hse_gc hse_gc_warn");
        if (is_open) card.setAttribute("data-open", "1");

        const gh = el("div", "hse_gh");
        const tog = _btn(is_open ? "▼" : "▶", "hse_gh_toggle", (ev) => {
          ev.stopPropagation();
          _collapsed_rooms.set("__none__", is_open);
          on_action("org_rerender");
        });
        gh.appendChild(tog);
        gh.appendChild(el("span", "hse_gh_icon", "❓"));
        gh.appendChild(el("span", "hse_gh_name", "Non affectés"));
        gh.appendChild(el("span", "hse_gh_count", `— ${visible.length} capteur(s)`));
        gh.addEventListener("click", () => {
          _collapsed_rooms.set("__none__", is_open);
          on_action("org_rerender");
        });
        card.appendChild(gh);

        if (is_open) {
          const body = el("div", "hse_gb");
          body.style.gridTemplateColumns = "1fr";
          body.appendChild(_render_sensor_col(
            "__none__", "Capteurs sans pièce", "power", visible,
            "", _collapsed_rfam,
            (fam) => _modal_move(fam.all, null, rooms, on_action, () => on_action("org_rerender")),
            (eid) => _modal_move([eid], null, rooms, on_action, () => on_action("org_rerender")),
            () => on_action("org_rerender")
          ));
          card.appendChild(body);
        }

        list_ctn.appendChild(card);
      }
    }

    // Cartes pièces
    sorted_room_keys.forEach((room_id) => {
      const room_cfg = rooms[room_id];
      const name = room_cfg?.name || room_id;
      const eids = by_room[room_id] || [];

      if (_rooms_filter) {
        const q = _rooms_filter.toLowerCase();
        const room_match = room_id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
        const entity_match = eids.some((eid) => eid.toLowerCase().includes(q));
        if (!room_match && !entity_match) return;
      }

      if (!_collapsed_rooms.has(room_id)) _collapsed_rooms.set(room_id, true);
      const is_open = !_collapsed_rooms.get(room_id);

      const energy_eids = eids.filter((eid) => /_energy|_kwh|_consumption/i.test(eid) && !/_power_energy/i.test(eid));
      const power_eids  = eids.filter((eid) => /_power/i.test(eid) && !/_power_energy/i.test(eid));
      const other_eids  = eids.filter((eid) => !energy_eids.includes(eid) && !power_eids.includes(eid));
      const main_eids   = [...power_eids, ...other_eids];

      const card = el("div", "hse_gc");
      if (is_open) card.setAttribute("data-open", "1");

      const gh = el("div", "hse_gh");
      const tog = _btn(is_open ? "▼" : "▶", "hse_gh_toggle", (ev) => {
        ev.stopPropagation();
        _collapsed_rooms.set(room_id, is_open);
        on_action("org_rerender");
      });
      gh.appendChild(tog);
      gh.appendChild(el("span", "hse_gh_icon", "🏠"));
      gh.appendChild(el("span", "hse_gh_name", name));
      gh.appendChild(el("span", "hse_gh_count", `— ${eids.length} capteur(s)`));

      if (room_cfg?.mode) gh.appendChild(el("span", "hse_gh_mode", room_cfg.mode));

      const acts = el("div", "hse_gh_actions");
      const rename_btn = _btn("✏️", "hse_gh_ab", (ev) => {
        ev.stopPropagation();
        const nv = window.prompt("Nouveau nom :", name);
        if (!nv || nv.trim() === name) return;
        on_action("org_patch", { path: `rooms.${room_id}.name`, value: nv.trim() });
      });
      rename_btn.title = "Renommer";
      acts.appendChild(rename_btn);

      const del_btn = _btn("🗑️", "hse_gh_ab danger", (ev) => {
        ev.stopPropagation();
        if (!window.confirm(`Supprimer la pièce "${name}" ?`)) return;
        on_action("org_room_delete", { room_id });
      });
      del_btn.title = "Supprimer";
      acts.appendChild(del_btn);

      gh.appendChild(acts);
      gh.addEventListener("click", () => {
        _collapsed_rooms.set(room_id, is_open);
        on_action("org_rerender");
      });
      card.appendChild(gh);

      if (is_open) {
        const body = el("div", "hse_gb");
        const cols_count = (main_eids.length > 0 ? 1 : 0) + (_show_energy_col && energy_eids.length > 0 ? 1 : 0);
        if (cols_count <= 1) body.style.gridTemplateColumns = "1fr";

        if (main_eids.length > 0) {
          body.appendChild(_render_sensor_col(
            room_id, "Capteurs power / autres", "power", main_eids,
            _rooms_filter, _collapsed_rfam,
            (fam) => _modal_move(fam.all, room_id, rooms, on_action, () => on_action("org_rerender")),
            (eid) => _modal_move([eid], room_id, rooms, on_action, () => on_action("org_rerender")),
            () => on_action("org_rerender")
          ));
        }
        if (_show_energy_col && energy_eids.length > 0) {
          body.appendChild(_render_sensor_col(
            room_id + ":e", "Capteurs energy", "energy", energy_eids,
            _rooms_filter, _collapsed_rfam,
            (fam) => _modal_move(fam.all, room_id, rooms, on_action, () => on_action("org_rerender")),
            (eid) => _modal_move([eid], room_id, rooms, on_action, () => on_action("org_rerender")),
            () => on_action("org_rerender")
          ));
        }
        if (!main_eids.length && !energy_eids.length) {
          const empty = el("div", "hse_gb"); empty.style.gridTemplateColumns = "1fr";
          empty.appendChild(el("div", "hse_sc_empty", "Aucun capteur affecté à cette pièce."));
          card.appendChild(empty);
        } else {
          card.appendChild(body);
        }
      }

      list_ctn.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // _refresh_types_list — redessine uniquement list_ctn types
  // ---------------------------------------------------------------------------

  function _refresh_types_list(list_ctn, assignments, on_action) {
    clear(list_ctn);

    const known_types = _collect_known_types(assignments);

    const by_type = {};
    Object.entries(assignments || {}).forEach(([eid, a]) => {
      const tid = a?.type_id || "__none__";
      if (!by_type[tid]) by_type[tid] = [];
      by_type[tid].push(eid);
    });

    const sorted_type_keys = _types_sort_asc
      ? [...known_types].sort()
      : [...known_types].sort().reverse();

    // Carte Sans type
    const untyped = by_type["__none__"] || [];
    if (untyped.length > 0) {
      const q = _types_filter.toLowerCase();
      const visible = q ? untyped.filter((eid) => eid.toLowerCase().includes(q)) : untyped;
      if (visible.length > 0) {
        if (!_collapsed_types.has("__none__")) _collapsed_types.set("__none__", false);
        const is_open = !_collapsed_types.get("__none__");

        const card = el("div", "hse_gc hse_gc_warn");
        if (is_open) card.setAttribute("data-open", "1");

        const gh = el("div", "hse_gh");
        gh.appendChild(_btn(is_open ? "▼" : "▶", "hse_gh_toggle", (ev) => {
          ev.stopPropagation();
          _collapsed_types.set("__none__", is_open);
          on_action("org_rerender");
        }));
        gh.appendChild(el("span", "hse_gh_icon", "❓"));
        gh.appendChild(el("span", "hse_gh_name", "Sans type"));
        gh.appendChild(el("span", "hse_gh_count", `— ${visible.length} capteur(s)`));
        gh.addEventListener("click", () => {
          _collapsed_types.set("__none__", is_open);
          on_action("org_rerender");
        });
        card.appendChild(gh);

        if (is_open) {
          const body = el("div", "hse_gb"); body.style.gridTemplateColumns = "1fr";
          body.appendChild(_render_sensor_col(
            "__none__:t", "Capteurs non typés", "power", visible,
            "", _collapsed_tfam,
            (fam) => _modal_type(fam.all, null, known_types, on_action, () => on_action("org_rerender")),
            (eid) => _modal_type([eid], null, known_types, on_action, () => on_action("org_rerender")),
            () => on_action("org_rerender")
          ));
          card.appendChild(body);
        }
        list_ctn.appendChild(card);
      }
    }

    sorted_type_keys.forEach((type_id) => {
      const eids = by_type[type_id] || [];

      if (_types_filter) {
        const q = _types_filter.toLowerCase();
        const tm = type_id.toLowerCase().includes(q);
        const em = eids.some((eid) => eid.toLowerCase().includes(q));
        if (!tm && !em) return;
      }

      if (!_collapsed_types.has(type_id)) _collapsed_types.set(type_id, true);
      const is_open = !_collapsed_types.get(type_id);

      const power_eids  = eids.filter((eid) => !/_energy|_kwh/i.test(eid) || /_power_energy/i.test(eid));
      const energy_eids = eids.filter((eid) => !power_eids.includes(eid));

      const card = el("div", "hse_gc");
      if (is_open) card.setAttribute("data-open", "1");

      const gh = el("div", "hse_gh");
      gh.appendChild(_btn(is_open ? "▼" : "▶", "hse_gh_toggle", (ev) => {
        ev.stopPropagation();
        _collapsed_types.set(type_id, is_open);
        on_action("org_rerender");
      }));
      gh.appendChild(el("span", "hse_gh_icon", "🏷️"));
      gh.appendChild(el("span", "hse_gh_name", type_id));
      gh.appendChild(el("span", "hse_gh_count", `— ${eids.length} capteur(s)`));

      const acts = el("div", "hse_gh_actions");
      const del_btn = _btn("🗑️", "hse_gh_ab danger", (ev) => {
        ev.stopPropagation();
        if (!window.confirm(`Retirer le type "${type_id}" de tous les capteurs ?`)) return;
        (by_type[type_id] || []).forEach((eid) => {
          on_action("org_patch", { path: `assignments.${eid}.type_id`, value: null, no_render: true });
        });
        on_action("org_rerender");
      });
      del_btn.title = "Retirer ce type de tous les capteurs";
      acts.appendChild(del_btn);
      gh.appendChild(acts);

      gh.addEventListener("click", () => {
        _collapsed_types.set(type_id, is_open);
        on_action("org_rerender");
      });
      card.appendChild(gh);

      if (is_open) {
        const body = el("div", "hse_gb");
        const cols_count = 1 + (_show_energy_col && energy_eids.length > 0 ? 1 : 0);
        if (cols_count <= 1) body.style.gridTemplateColumns = "1fr";

        body.appendChild(_render_sensor_col(
          type_id, "Capteurs power", "power", power_eids,
          _types_filter, _collapsed_tfam,
          (fam) => _modal_type(fam.all, type_id, known_types, on_action, () => on_action("org_rerender")),
          (eid) => _modal_type([eid], type_id, known_types, on_action, () => on_action("org_rerender")),
          () => on_action("org_rerender")
        ));

        if (_show_energy_col && energy_eids.length > 0) {
          body.appendChild(_render_sensor_col(
            type_id + ":e", "Capteurs energy", "energy", energy_eids,
            _types_filter, _collapsed_tfam,
            (fam) => _modal_type(fam.all, type_id, known_types, on_action, () => on_action("org_rerender")),
            (eid) => _modal_type([eid], type_id, known_types, on_action, () => on_action("org_rerender")),
            () => on_action("org_rerender")
          ));
        }
        card.appendChild(body);
      }

      list_ctn.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Section ROOMS
  // ---------------------------------------------------------------------------

  function _render_rooms_section(container, rooms, assignments, on_action) {
    clear(container);

    // ── Headerbar ──────────────────────────────────────────────────
    const hbar = el("div", "hse_hbar");
    hbar.appendChild(el("div", "hse_hbar_title", "Pièces & capteurs"));
    hbar.appendChild(el("div", "hse_hbar_spacer"));

    const fi = _inp("Filtrer les pièces ou capteurs…", _rooms_filter, "hse_input hse_filter");

    // list_ctn déclaré ici pour être accessible depuis le listener filtre
    const list_ctn = el("div", "hse_groups");

    fi.addEventListener("input", (ev) => {
      _rooms_filter = ev.target.value || "";
      _refresh_rooms_list(list_ctn, rooms, assignments, on_action);
    });
    hbar.appendChild(fi);

    hbar.appendChild(_btn(_rooms_sort_asc ? "Tri A→Z" : "Tri Z→A", "hse_button", () => {
      _rooms_sort_asc = !_rooms_sort_asc;
      on_action("org_rerender");
    }));

    hbar.appendChild(_btn("+ Ajouter une pièce", "hse_button", () => {
      const name = window.prompt("Nom de la nouvelle pièce :");
      if (!name) return;
      const trimmed = name.trim();
      const def_id = trimmed.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "").slice(0, 60);
      const room_id = window.prompt("room_id ?", def_id);
      if (!room_id) return;
      on_action("org_room_add", { room_id: room_id.trim(), name: trimmed });
    }));

    hbar.appendChild(_btn("Rafraîchir", "hse_button", () => on_action("org_refresh")));

    hbar.appendChild(_btn("⚡ Auto rooms", "hse_button hse_button_primary", () => {
      let count = 0;
      Object.entries(assignments || {}).forEach(([eid, a]) => {
        if (!a || a.room_id) return;
        const s = eid.toLowerCase();
        for (const [kw, room_id] of Object.entries(DEFAULT_ROOM_KEYWORDS)) {
          if (rooms[room_id] && s.includes(kw.toLowerCase())) {
            on_action("org_patch", { path: `assignments.${eid}.room_id`, value: room_id, no_render: true });
            count++;
            break;
          }
        }
      });
      alert(`Auto rooms : ${count} capteur(s) assigné(s) automatiquement.`);
      on_action("org_rerender");
    }));

    hbar.appendChild(_btn("Sauvegarder", "hse_button", () => on_action("org_save")));
    container.appendChild(hbar);

    // ── Bulk bar ──────────────────────────────────────────────── (état persisté)
    const bulk = el("div", "hse_bulkbar");
    bulk.appendChild(document.createTextNode("Déplacement en masse :"));

    const kw_inp = _inp("Mot-clé (ex: emma)…", _bulk_rooms_kw, "hse_input hse_bulkbar_kw");
    kw_inp.addEventListener("input", (ev) => { _bulk_rooms_kw = ev.target.value || ""; });
    bulk.appendChild(kw_inp);

    bulk.appendChild(document.createTextNode(" vers : "));

    const room_opts = _keys_sorted(rooms).map((rid) => ({
      value: rid,
      label: rooms[rid]?.name || rid,
    }));
    const tgt_sel = _sel(room_opts, _bulk_rooms_target, "hse_input hse_bulkbar_sel");
    tgt_sel.addEventListener("change", (ev) => { _bulk_rooms_target = ev.target.value || ""; });
    bulk.appendChild(tgt_sel);

    bulk.appendChild(_btn("Déplacer en masse", "hse_button hse_button_primary", () => {
      const kw = kw_inp.value.trim().toLowerCase();
      if (!kw) { alert("Saisir un mot-clé."); return; }
      const target_room = tgt_sel.value;
      if (!target_room) { alert("Choisir une pièce cible."); return; }

      let count = 0;
      Object.keys(assignments || {}).forEach((eid) => {
        if (eid.toLowerCase().includes(kw)) {
          on_action("org_patch", { path: `assignments.${eid}.room_id`, value: target_room, no_render: true });
          count++;
        }
      });

      if (count === 0) {
        alert(`Aucun capteur ne contient "${kw}".`);
      } else {
        alert(`${count} capteur(s) déplacé(s) vers « ${rooms[target_room]?.name || target_room} ».`);
        on_action("org_rerender");
      }
    }));

    container.appendChild(bulk);

    // ── Liste des cartes ────────────────────────────────────────────
    container.appendChild(list_ctn);
    _refresh_rooms_list(list_ctn, rooms, assignments, on_action);
  }

  // ---------------------------------------------------------------------------
  // Section TYPES
  // ---------------------------------------------------------------------------

  function _collect_known_types(assignments) {
    const s = new Set();
    Object.values(assignments || {}).forEach((a) => { if (a?.type_id) s.add(a.type_id); });
    return s;
  }

  function _render_types_section(container, assignments, on_action) {
    clear(container);
    const known_types = _collect_known_types(assignments);

    // ── Headerbar ──────────────────────────────────────────────────
    const hbar = el("div", "hse_hbar");
    hbar.appendChild(el("div", "hse_hbar_title", "Types (catégories)"));
    hbar.appendChild(el("div", "hse_hbar_spacer"));

    const list_ctn = el("div", "hse_groups");

    const fi = _inp("Filtrer types ou capteurs…", _types_filter, "hse_input hse_filter");
    fi.addEventListener("input", (ev) => {
      _types_filter = ev.target.value || "";
      _refresh_types_list(list_ctn, assignments, on_action);
    });
    hbar.appendChild(fi);

    hbar.appendChild(_btn(_types_sort_asc ? "Tri A→Z" : "Tri Z→A", "hse_button", () => {
      _types_sort_asc = !_types_sort_asc;
      on_action("org_rerender");
    }));

    hbar.appendChild(_btn(_show_energy_col ? "Energy: ON" : "Energy: OFF", "hse_button", () => {
      _show_energy_col = !_show_energy_col;
      on_action("org_rerender");
    }));

    hbar.appendChild(_btn("+ Ajouter un type", "hse_button", () => {
      const n = window.prompt("Nom du nouveau type :");
      if (!n) return;
      on_action("org_type_create", { type_id: n.trim() });
    }));

    hbar.appendChild(_btn("⚡ Auto types", "hse_button hse_button_primary", () => {
      const energy_index = _build_energy_index(assignments);
      let count = 0;
      Object.entries(assignments || {}).forEach(([eid, a]) => {
        if (!a || a.type_id) return;
        const s = eid.toLowerCase();
        for (const [kw, type_name] of Object.entries(DEFAULT_TYPE_KEYWORDS)) {
          if (s.includes(kw.toLowerCase())) {
            on_action("org_patch", { path: `assignments.${eid}.type_id`, value: type_name, no_render: true });
            count++;
            const base = _family_base(eid, "power");
            const siblings = energy_index.get(base) || [];
            siblings.forEach((sib) => {
              if (assignments[sib] && !assignments[sib].type_id) {
                on_action("org_patch", { path: `assignments.${sib}.type_id`, value: type_name, no_render: true });
                count++;
              }
            });
            break;
          }
        }
      });
      alert(`Auto types : ${count} capteur(s) typé(s) automatiquement.`);
      on_action("org_rerender");
    }));

    container.appendChild(hbar);

    // ── Bulk bar ──────────────────────────────────────────────── (état persisté)
    const bulk = el("div", "hse_bulkbar");
    bulk.appendChild(document.createTextNode("Affecter en masse :"));

    const kw_inp = _inp("Mot-clé (ex: tv)…", _bulk_types_kw, "hse_input hse_bulkbar_kw");
    kw_inp.addEventListener("input", (ev) => { _bulk_types_kw = ev.target.value || ""; });
    bulk.appendChild(kw_inp);

    bulk.appendChild(document.createTextNode(" → type : "));

    const type_opts_bulk = [...known_types].sort().map((t) => ({ value: t, label: t }));
    if (!type_opts_bulk.length) type_opts_bulk.push({ value: "", label: "(aucun type défini)" });
    const tgt_sel = _sel(type_opts_bulk, _bulk_types_target, "hse_input hse_bulkbar_sel");
    tgt_sel.addEventListener("change", (ev) => { _bulk_types_target = ev.target.value || ""; });
    bulk.appendChild(tgt_sel);

    const new_t_inp = _inp("ou nouveau type…", "", "hse_input hse_bulkbar_inp");
    bulk.appendChild(new_t_inp);

    bulk.appendChild(_btn("Appliquer", "hse_button hse_button_primary", () => {
      const kw = kw_inp.value.trim().toLowerCase();
      if (!kw) { alert("Saisir un mot-clé."); return; }
      const target_type = new_t_inp.value.trim() || tgt_sel.value;
      if (!target_type) { alert("Choisir ou saisir un type cible."); return; }

      let count = 0;
      Object.keys(assignments || {}).forEach((eid) => {
        if (eid.toLowerCase().includes(kw)) {
          on_action("org_patch", { path: `assignments.${eid}.type_id`, value: target_type, no_render: true });
          count++;
        }
      });
      if (!count) alert(`Aucun capteur ne contient "${kw}".`);
      else {
        alert(`${count} capteur(s) affecté(s) au type « ${target_type} ».`);
        on_action("org_rerender");
      }
    }));

    container.appendChild(bulk);

    // ── Liste des cartes ────────────────────────────────────────────
    container.appendChild(list_ctn);
    _refresh_types_list(list_ctn, assignments, on_action);
  }

  // ---------------------------------------------------------------------------
  // Tables diff sync HA
  // ---------------------------------------------------------------------------

  function _render_sync_tables(card, pending) {
    const rooms       = pending?.rooms || {};
    const assignments = pending?.assignments || {};

    const add_table = (title, headers, rows) => {
      card.appendChild(el("div", "hse_subtitle", title));
      if (!rows.length) { card.appendChild(el("div", "hse_subtitle", "—")); return; }
      const wrap = el("div", "hse_scroll_area");
      const table = el("table", "hse_table");
      const thead = el("thead"); const trh = el("tr");
      headers.forEach((h) => trh.appendChild(el("th", null, h)));
      thead.appendChild(trh); table.appendChild(thead);
      const tbody = el("tbody");
      rows.forEach((r) => {
        const tr = el("tr");
        r.forEach((c) => tr.appendChild(el("td", null, c == null ? "" : String(c))));
        tbody.appendChild(tr);
      });
      table.appendChild(tbody); wrap.appendChild(table); card.appendChild(wrap);
    };

    const cr = Array.isArray(rooms.create) ? rooms.create : [];
    const rr = Array.isArray(rooms.rename) ? rooms.rename : [];
    const sr = Array.isArray(assignments.suggest_room) ? assignments.suggest_room : [];

    add_table("Créations de pièces", ["Nom","room_id","ha_area_id"],
      cr.map((x) => [x?.name, x?.room_id, x?.ha_area_id]));
    add_table("Renommages", ["room_id","De","Vers","Eligible"],
      rr.map((x) => [x?.room_id, x?.from, x?.to, x?.eligible ? "oui" : "non"]));
    add_table("Suggestions (pièce)", ["entity_id","De","Vers","Raison"],
      sr.map((x) => [x?.entity_id, x?.from_room_id || "—", x?.to_room_id, x?.reason || "—"]));
  }

  // ---------------------------------------------------------------------------
  // Entrée principale
  // ---------------------------------------------------------------------------

  function render_customisation(container, state, org_state, on_action) {
    _inject_styles();
    clear(container);

    const meta_store = org_state?.meta_store || null;
    const draft      = org_state?.meta_draft || null;

    const rooms_raw        = draft?.rooms || meta_store?.meta?.rooms || {};
    const rooms            = _normalize_rooms(rooms_raw);
    const assignments_raw  = draft?.assignments || meta_store?.meta?.assignments || {};
    const snapshot_ents    = meta_store?.sync?.snapshot?.entities || {};
    const assignments      = _hydrate_assignments(assignments_raw, rooms, snapshot_ents);

    const sync        = meta_store?.sync || null;
    const pending     = sync?.pending_diff || null;
    const has_pending = !!(pending && pending.has_changes);

    // ── Apparence ──────────────────────────────────────────────────
    const theme_card = el("div", "hse_card");
    theme_card.appendChild(el("div", null, "Apparence & Thème"));
    theme_card.appendChild(el("div", "hse_subtitle",
      "Le thème s'applique à tous les onglets du panel (stocké dans ce navigateur)."));
    const theme_row = el("div", "hse_toolbar");
    const theme_sel = _sel(THEMES.map((t) => ({ value: t.key, label: t.label })), state?.theme || "ha", "hse_input");
    theme_sel.style.minWidth = "220px";
    theme_sel.addEventListener("change", (ev) => on_action("set_theme", ev.target.value));
    theme_row.appendChild(theme_sel);
    theme_card.appendChild(theme_row);
    const toggles = el("div", "hse_badges");
    toggles.appendChild(_btn(state?.dynamic_bg ? "Fond: ON" : "Fond: OFF", "hse_button", () => on_action("toggle_dynamic_bg")));
    toggles.appendChild(_btn(state?.glass      ? "Glass: ON" : "Glass: OFF", "hse_button", () => on_action("toggle_glass")));
    theme_card.appendChild(toggles);
    container.appendChild(theme_card);

    // ── Sync HA ────────────────────────────────────────────────────
    const org = el("div", "hse_card");
    org.appendChild(el("div", null, "Sync Home Assistant"));
    org.appendChild(el("div", "hse_subtitle",
      "Prévisualise puis applique des propositions (pièces/affectations) à partir des zones Home Assistant."));
    if (sync?.last_error) org.appendChild(el("pre", "hse_code", String(sync.last_error)));

    const summary = [];
    if (has_pending) {
      const st = pending?.stats || {};
      summary.push(`Pièces: +${st?.create_rooms ?? 0}`);
      summary.push(`renommages: ${st?.rename_rooms ?? 0}`);
      summary.push(`suggestions: ${st?.suggest_room ?? 0}`);
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
    tb.appendChild(_btn("Prévisualiser sync HA", "hse_button", () => on_action("org_preview")));

    const btn_auto = _btn("Appliquer sync HA (auto)", "hse_button",
      () => on_action("org_apply", { apply_mode: "auto" }));
    btn_auto.disabled = !has_pending || !!org_state?.apply_running;
    tb.appendChild(btn_auto);

    const btn_all = _btn("Appliquer sync HA (all)", "hse_button",
      () => on_action("org_apply", { apply_mode: "all" }));
    btn_all.disabled = !has_pending || !!org_state?.apply_running;
    tb.appendChild(btn_all);

    tb.appendChild(_btn(org_state?.show_raw ? "Debug: ON" : "Debug: OFF", "hse_button",
      () => on_action("org_toggle_raw")));
    org.appendChild(tb);

    if (org_state?.message) org.appendChild(el("div", "hse_subtitle", String(org_state.message)));
    if (org_state?.error)   org.appendChild(el("pre", "hse_code", String(org_state.error)));
    if (has_pending) _render_sync_tables(org, pending);
    if (org_state?.show_raw) {
      org.appendChild(el("div", "hse_subtitle", "Données brutes"));
      org.appendChild(el("pre", "hse_code",
        JSON.stringify({ meta_store, meta_draft: draft }, null, 2)));
    }
    container.appendChild(org);

    // ── Section Rooms ──────────────────────────────────────────────
    const rooms_card = el("div", "hse_card");
    const rooms_sec  = el("div");
    rooms_card.appendChild(rooms_sec);
    container.appendChild(rooms_card);
    _render_rooms_section(rooms_sec, rooms, assignments, on_action);

    // ── Section Types ──────────────────────────────────────────────
    const types_card = el("div", "hse_card");
    const types_sec  = el("div");
    types_card.appendChild(types_sec);
    container.appendChild(types_card);
    _render_types_section(types_sec, assignments, on_action);
  }

  window.hse_custom_view = { render_customisation };
})();
