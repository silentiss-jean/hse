/*
HSE_DOC: custom_components/hse/docs/config_ui.md
HSE_MAINTENANCE: If you change UI semantics here, update the doc above.
*/

(function () {
  const { el, clear } = window.hse_dom;

  function _current_reference_entity_id(catalogue) {
    const items = catalogue?.items || {};
    for (const it of Object.values(items)) {
      if (!it || typeof it !== "object") continue;
      const enr = it.enrichment || {};
      if (enr.is_reference_total === true) {
        const src = it.source || {};
        return src.entity_id || null;
      }
    }
    return null;
  }

  function _reference_status_from_catalogue(catalogue, entity_id) {
    const items = catalogue?.items || {};
    let fallback = null;

    for (const it of Object.values(items)) {
      if (!it || typeof it !== "object") continue;
      const src = it.source || {};
      const wf = it.workflow?.reference_enrichment;
      if (!wf || typeof wf !== "object") continue;

      const snapshot = {
        item_id: it.id || null,
        entity_id: src.entity_id || null,
        ...wf,
      };

      if (entity_id && snapshot.entity_id === entity_id) return snapshot;
      if (it.enrichment?.is_reference_total === true) fallback = snapshot;
      else if (!fallback) fallback = snapshot;
    }

    return fallback;
  }

  function _power_candidates(scan_result) {
    const out = [];
    for (const c of scan_result?.candidates || []) {
      if (!c) continue;
      if (c.kind !== "power") continue;

      const status = String(c.status || "").toLowerCase();
      if (status && status !== "ok") continue;

      const st = String(c.ha_state || "").toLowerCase();
      if (st === "unavailable" || st === "unknown") continue;

      out.push(c);
    }

    out.sort((a, b) => {
      const ai = String(a.integration_domain || "");
      const bi = String(b.integration_domain || "");
      if (ai !== bi) return ai.localeCompare(bi);
      const an = String(a.name || a.entity_id || "");
      const bn = String(b.name || b.entity_id || "");
      return an.localeCompare(bn);
    });

    return out;
  }

  function _get(obj, path, fallback) {
    const parts = String(path || "").split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (!cur || typeof cur !== "object") return fallback;
      cur = cur[p];
    }
    return cur == null ? fallback : cur;
  }

  function _mk_select(options, value, on_change) {
    const sel = document.createElement("select");
    sel.className = "hse_input";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      sel.appendChild(o);
    }
    sel.value = value || "";
    sel.addEventListener("change", () => on_change(sel.value));
    return sel;
  }

  function _mk_number(value, step, on_input) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = step || "0.0001";
    inp.className = "hse_input";
    inp.value = value == null ? "" : String(value);
    inp.addEventListener("input", () => on_input(inp.value));
    return inp;
  }

  function _mk_time(value, on_input) {
    const inp = document.createElement("input");
    inp.type = "time";
    inp.className = "hse_input";
    inp.value = value || "";
    inp.addEventListener("input", () => on_input(inp.value));
    return inp;
  }

  function _mk_button(label, on_click) {
    const b = el("button", "hse_button", label);
    b.addEventListener("click", on_click);
    return b;
  }

  function _mk_table(items, cols) {
    const table = document.createElement("table");
    table.className = "hse_table";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c.label;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const it of items) {
      const tr = document.createElement("tr");
      for (const c of cols) {
        const td = document.createElement("td");
        const v = c.value(it);
        if (v instanceof Node) td.appendChild(v);
        else td.textContent = v == null ? "" : String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    return table;
  }

  function _filter_candidates(candidates, q) {
    if (!q) return candidates;
    const needle = String(q || "").toLowerCase();
    return candidates.filter((c) => {
      const hay = `${c.entity_id} ${c.name} ${c.integration_domain} ${c.kind} ${c.unit} ${c.state_class} ${c.status} ${c.ha_state}`.toLowerCase();
      return hay.includes(needle);
    });
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
      items.sort((a, b) => String(a.name || a.entity_id || "").localeCompare(String(b.name || b.entity_id || "")));
      groups.push({ integration_domain, items, total: items.length });
    }
    groups.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
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

  function _workflow_status_badge_class(status) {
    const s = String(status || "idle").toLowerCase();
    if (s === "ready") return "hse_badge_status_ok";
    if (s === "failed") return "hse_badge_warn";
    if (s === "running" || s === "pending_background") return "hse_badge_status_warn";
    return "";
  }

  function _workflow_status_label(status) {
    const s = String(status || "idle").toLowerCase();
    if (s === "ready") return "prêt";
    if (s === "running") return "en cours";
    if (s === "pending_background") return "arrière-plan";
    if (s === "failed") return "échec";
    return "idle";
  }

  function _workflow_status_bg(status) {
    const s = String(status || "idle").toLowerCase();
    if (s === "ready") return "var(--success-color, rgba(46,125,50,.14))";
    if (s === "failed") return "var(--error-color, rgba(211,47,47,.12))";
    if (s === "running" || s === "pending_background") return "var(--warning-color, rgba(249,168,37,.12))";
    return "var(--ha-card-background, rgba(255,255,255,.04))";
  }

  function _group_key(c) {
    if (!c || !c.device_id) return null;
    // Intentionally ignore unit to catch W vs kW and other naming variants.
    return `${c.device_id}|${c.kind || ""}|${c.device_class || ""}|${c.state_class || ""}`;
  }

  function _score_candidate(c) {
    let s = 0;

    const status = String(c.status || "").toLowerCase();
    if (status === "ok") s += 30;
    else if (status) s -= 80;

    const st = String(c.ha_state || "").toLowerCase();
    if (st === "unknown" || st === "unavailable") s -= 60;

    if (c.ha_restored) s -= 10;

    if (c.device_id) s += 10;
    if (c.unique_id) s += 2;

    if (c.state_class === "measurement") s += 2;

    const integ = String(c.integration_domain || "").toLowerCase();
    if (integ === "tplink") s += 2; // official tie-break
    else if (integ === "tapo") s += 1;

    return s;
  }

  function _build_duplicate_index(all_candidates) {
    const by_group = new Map();
    const eid_to_group = {};

    for (const c of all_candidates || []) {
      const gk = _group_key(c);
      if (!gk) continue;
      eid_to_group[c.entity_id] = gk;
      if (!by_group.has(gk)) by_group.set(gk, []);
      by_group.get(gk).push(c);
    }

    const group_meta = new Map();
    for (const [gk, items] of by_group.entries()) {
      if (!items || items.length <= 1) continue;
      let best = items[0];
      for (const c of items.slice(1)) {
        const sa = _score_candidate(best);
        const sb = _score_candidate(c);
        if (sb > sa) best = c;
        else if (sb === sa) {
          const ia = String(best.integration_domain || "").toLowerCase();
          const ib = String(c.integration_domain || "").toLowerCase();
          if (ib === "tplink" && ia !== "tplink") best = c;
        }
      }
      group_meta.set(gk, { size: items.length, best_entity_id: best.entity_id });
    }

    return { by_group, eid_to_group, group_meta };
  }

  function _render_candidate_groups(container, groups, opts) {
    if (opts?.clear !== false) clear(container);

    if (Array.isArray(opts?.prepend)) {
      for (const n of opts.prepend) {
        if (n) container.appendChild(n);
      }
    }

    const box = el("div", "hse_groups");

    for (const g of groups) {
      const details = document.createElement("details");
      details.className = "hse_fold";
      details.open = opts?.open_by_default === true;

      const summary_el = document.createElement("summary");
      summary_el.className = "hse_fold_summary";

      const left = el("div", "hse_fold_left");
      left.appendChild(el("div", "hse_fold_title", g.integration_domain));

      const right = el("div", "hse_badges");
      right.appendChild(el("span", "hse_badge", `total: ${g.total}`));

      summary_el.appendChild(left);
      summary_el.appendChild(right);

      const body = el("div", "hse_fold_body");

      const list = el("div", "hse_candidate_list");

      for (const c of g.items) {
        const row = el("div", "hse_candidate_row");

        const main = el("div", "hse_candidate_main");
        main.appendChild(el("div", "hse_mono", c.entity_id));
        if (c.name && c.name !== c.entity_id) main.appendChild(el("div", "hse_subtitle", c.name));

        const meta = el("div", "hse_candidate_meta");
        const badges = el("div", "hse_badges");

        badges.appendChild(el("span", "hse_badge", c.integration_domain || "—"));
        if (c.kind) badges.appendChild(el("span", "hse_badge", c.kind));

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

        const dup = opts?.get_dup_badge?.(c);
        if (dup) badges.appendChild(dup);

        meta.appendChild(badges);

        const actions = el("div", "hse_toolbar");
        const btn = opts?.make_action_button?.(c);
        if (btn) actions.appendChild(btn);

        row.appendChild(main);
        row.appendChild(meta);
        row.appendChild(actions);
        list.appendChild(row);
      }

      body.appendChild(list);

      details.appendChild(summary_el);
      details.appendChild(body);
      box.appendChild(details);
    }

    container.appendChild(box);
  }

  function render_config(container, model, on_action) {
    clear(container);

    const headerCard = el("div", "hse_card");
    const header = el("div", null);
    header.appendChild(el("div", null, "Configuration"));
    header.appendChild(
      el(
        "div",
        "hse_subtitle",
        "Ordre recommandé : 1) Contrat/Tarifs. 2) Capteur de référence (compteur total). 3) Capteurs utilisés pour le calcul."
      )
    );
    headerCard.appendChild(header);

    // Shared data
    const savedPricing = model.pricing || null;
    const draft = model.pricing_draft || model.pricing || model.pricing_defaults || {};
    const candidates = _power_candidates(model.scan_result);

    const effectiveRef = model.selected_reference_entity_id || model.current_reference_entity_id || null;
    const refStatus = model.reference_status || _reference_status_from_catalogue(model.catalogue, effectiveRef);

    const selectedIdsRaw = Array.isArray(_get(draft, "cost_entity_ids", [])) ? _get(draft, "cost_entity_ids", []) : [];
    const selectedIds = effectiveRef ? selectedIdsRaw.filter((x) => x !== effectiveRef) : selectedIdsRaw.slice();
    const selectedSet = new Set(selectedIds);
    const hadRefConflict = !!(effectiveRef && selectedIdsRaw.includes(effectiveRef));

    const candidatesForCost = effectiveRef ? candidates.filter((c) => c.entity_id !== effectiveRef) : candidates;

    // Duplicate index (power + energy for reporting)
    const allCandidates = Array.isArray(model.scan_result?.candidates) ? model.scan_result.candidates : [];
    const allById = new Map();
    for (const c of allCandidates) {
      if (c && c.entity_id) allById.set(c.entity_id, c);
    }

    const { by_group, eid_to_group, group_meta } = _build_duplicate_index(allCandidates);

    const selectedByGroup = new Map();
    for (const eid of selectedIds) {
      const gk = eid_to_group[eid];
      if (!gk) continue;
      // If multiple selected somehow, keep first for UI hinting.
      if (!selectedByGroup.has(gk)) selectedByGroup.set(gk, eid);
    }

    const filter_q = model.cost_filter_q || "";

    // 1) Pricing panel
    const pricingCard = el("div", "hse_card");
    pricingCard.appendChild(el("div", null, "Contrat / Tarifs"));
    pricingCard.appendChild(
      el(
        "div",
        "hse_subtitle",
        "Renseigne HT et TTC (on ne déduit jamais la TVA). Les heures creuses sont configurables (défaut 22:00 → 06:00)."
      )
    );

    const savedLine = el("div", "hse_subtitle");
    if (savedPricing?.updated_at) {
      savedLine.textContent = `Tarifs enregistrés (updated_at): ${savedPricing.updated_at}`;
    } else {
      savedLine.textContent = "Tarifs enregistrés: (aucun)";
    }
    pricingCard.appendChild(savedLine);

    const contractType = _get(draft, "contract_type", "fixed");
    const displayMode = _get(draft, "display_mode", "ttc");

    const rowType = el("div", "hse_toolbar");
    rowType.appendChild(el("div", "hse_subtitle", "Type de contrat"));
    const selType = _mk_select(
      [
        { value: "fixed", label: "Prix fixe" },
        { value: "hphc", label: "HP / HC" },
      ],
      contractType,
      (v) => on_action("pricing_patch", { path: "contract_type", value: v })
    );
    rowType.appendChild(selType);

    rowType.appendChild(el("div", "hse_subtitle", "Mode d'affichage"));
    const selMode = _mk_select(
      [
        { value: "ttc", label: "TTC" },
        { value: "ht", label: "HT" },
      ],
      displayMode,
      (v) => on_action("pricing_patch", { path: "display_mode", value: v })
    );
    rowType.appendChild(selMode);

    pricingCard.appendChild(rowType);

    const rowSub = el("div", "hse_toolbar");
    rowSub.appendChild(el("div", "hse_subtitle", "Abonnement mensuel HT"));
    rowSub.appendChild(
      _mk_number(_get(draft, "subscription_monthly.ht", ""), "0.01", (v) =>
        on_action("pricing_patch", { path: "subscription_monthly.ht", value: v, no_render: true })
      )
    );
    rowSub.appendChild(el("div", "hse_subtitle", "Abonnement mensuel TTC"));
    rowSub.appendChild(
      _mk_number(_get(draft, "subscription_monthly.ttc", ""), "0.01", (v) =>
        on_action("pricing_patch", { path: "subscription_monthly.ttc", value: v, no_render: true })
      )
    );
    pricingCard.appendChild(rowSub);

    if (contractType === "fixed") {
      const rowFixed = el("div", "hse_toolbar");
      rowFixed.appendChild(el("div", "hse_subtitle", "Prix énergie (€/kWh) HT"));
      rowFixed.appendChild(
        _mk_number(_get(draft, "fixed_energy_per_kwh.ht", ""), "0.0001", (v) =>
          on_action("pricing_patch", { path: "fixed_energy_per_kwh.ht", value: v, no_render: true })
        )
      );
      rowFixed.appendChild(el("div", "hse_subtitle", "Prix énergie (€/kWh) TTC"));
      rowFixed.appendChild(
        _mk_number(_get(draft, "fixed_energy_per_kwh.ttc", ""), "0.0001", (v) =>
          on_action("pricing_patch", { path: "fixed_energy_per_kwh.ttc", value: v, no_render: true })
        )
      );
      pricingCard.appendChild(rowFixed);
    } else {
      const rowHP = el("div", "hse_toolbar");
      rowHP.appendChild(el("div", "hse_subtitle", "Prix HP (€/kWh) HT"));
      rowHP.appendChild(
        _mk_number(_get(draft, "hp_energy_per_kwh.ht", ""), "0.0001", (v) =>
          on_action("pricing_patch", { path: "hp_energy_per_kwh.ht", value: v, no_render: true })
        )
      );
      rowHP.appendChild(el("div", "hse_subtitle", "Prix HP (€/kWh) TTC"));
      rowHP.appendChild(
        _mk_number(_get(draft, "hp_energy_per_kwh.ttc", ""), "0.0001", (v) =>
          on_action("pricing_patch", { path: "hp_energy_per_kwh.ttc", value: v, no_render: true })
        )
      );
      pricingCard.appendChild(rowHP);

      const rowHC = el("div", "hse_toolbar");
      rowHC.appendChild(el("div", "hse_subtitle", "Prix HC (€/kWh) HT"));
      rowHC.appendChild(
        _mk_number(_get(draft, "hc_energy_per_kwh.ht", ""), "0.0001", (v) =>
          on_action("pricing_patch", { path: "hc_energy_per_kwh.ht", value: v, no_render: true })
        )
      );
      rowHC.appendChild(el("div", "hse_subtitle", "Prix HC (€/kWh) TTC"));
      rowHC.appendChild(
        _mk_number(_get(draft, "hc_energy_per_kwh.ttc", ""), "0.0001", (v) =>
          on_action("pricing_patch", { path: "hc_energy_per_kwh.ttc", value: v, no_render: true })
        )
      );
      pricingCard.appendChild(rowHC);

      const rowSched = el("div", "hse_toolbar");
      rowSched.appendChild(el("div", "hse_subtitle", "Heures creuses start"));
      rowSched.appendChild(
        _mk_time(_get(draft, "hc_schedule.start", "22:00"), (v) =>
          on_action("pricing_patch", { path: "hc_schedule.start", value: v, no_render: true })
        )
      );
      rowSched.appendChild(el("div", "hse_subtitle", "Heures creuses end"));
      rowSched.appendChild(
        _mk_time(_get(draft, "hc_schedule.end", "06:00"), (v) =>
          on_action("pricing_patch", { path: "hc_schedule.end", value: v, no_render: true })
        )
      );
      pricingCard.appendChild(rowSched);
    }

    // Pricing buttons at the end (as requested)
    const pricingToolbar = el("div", "hse_toolbar");

    const btnPricingSave = el(
      "button",
      "hse_button hse_button_primary",
      model.pricing_saving ? "Sauvegarde…" : "Sauvegarder tarifs (incl. capteurs)"
    );
    btnPricingSave.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnPricingSave.addEventListener("click", () => {
      btnPricingSave.disabled = true;
      btnPricingSave.textContent = "Sauvegarde…";
      on_action("pricing_save");
    });

    const btnPricingClear = el("button", "hse_button", "Effacer tarifs");
    btnPricingClear.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnPricingClear.addEventListener("click", () => on_action("pricing_clear"));

    pricingToolbar.appendChild(btnPricingSave);
    pricingToolbar.appendChild(btnPricingClear);
    pricingCard.appendChild(pricingToolbar);

    if (model.pricing_message) {
      pricingCard.appendChild(el("div", "hse_subtitle", model.pricing_message));
    }

    if (model.pricing_error) {
      pricingCard.appendChild(el("pre", "hse_code", String(model.pricing_error)));
    }

    // 2) Reference panel (independent)
    const refCard = el("div", "hse_card");
    refCard.appendChild(el("div", null, "Capteur de référence (compteur total)"));
    refCard.appendChild(
      el(
        "div",
        "hse_subtitle",
        "Le capteur de référence est indépendant: il sert de vérité terrain des coûts (comparaison), et ne peut pas être inclus dans les capteurs de calcul."
      )
    );

    const refToolbar = el("div", "hse_toolbar");

    const btnRefresh = el("button", "hse_button", model.loading ? "Chargement…" : "Rafraîchir");
    btnRefresh.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnRefresh.addEventListener("click", () => on_action("refresh"));

    const btnSave = el("button", "hse_button hse_button_primary", model.saving ? "Sauvegarde…" : "Sauvegarder");
    btnSave.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnSave.addEventListener("click", () => on_action("save_reference"));

    const btnClear = el("button", "hse_button", "Supprimer la référence");
    btnClear.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnClear.addEventListener("click", () => on_action("clear_reference"));

    refToolbar.appendChild(btnRefresh);
    refToolbar.appendChild(btnSave);
    refToolbar.appendChild(btnClear);
    refCard.appendChild(refToolbar);

    const refLine = el("div", "hse_subtitle");
    const currentRef = model.current_reference_entity_id || "(Aucune référence sélectionnée)";
    refLine.textContent = `Référence actuelle: ${currentRef}`;
    refCard.appendChild(refLine);

    if (refStatus) {
      const statusBox = el("div", "hse_card hse_card_inner");
      statusBox.style.background = _workflow_status_bg(refStatus.status);
      statusBox.appendChild(el("div", null, "Progression du workflow"));

      const badges = el("div", "hse_badges");
      badges.appendChild(
        el("span", `hse_badge ${_workflow_status_badge_class(refStatus.status)}`.trim(), `statut: ${_workflow_status_label(refStatus.status)}`)
      );
      if (refStatus.progress_phase) badges.appendChild(el("span", "hse_badge", `phase: ${refStatus.progress_phase}`));
      if (refStatus.retry_scheduled || refStatus.will_retry) badges.appendChild(el("span", "hse_badge hse_badge_warn", "retry planifié"));
      if (refStatus.done) badges.appendChild(el("span", "hse_badge hse_badge_status_ok", "terminé"));
      statusBox.appendChild(badges);

      statusBox.appendChild(el("div", "hse_subtitle", refStatus.progress_label || "Aucun traitement actif."));
      if (refStatus.attempt || refStatus.attempts_total) {
        statusBox.appendChild(el("div", "hse_subtitle", `Tentative: ${refStatus.attempt || 0}/${refStatus.attempts_total || "?"}`));
      }
      if (refStatus.mapping && typeof refStatus.mapping === "object") {
        const lines = Object.entries(refStatus.mapping)
          .filter(([, v]) => !!v)
          .map(([k, v]) => `${k}: ${v}`);
        if (lines.length) statusBox.appendChild(el("pre", "hse_code", lines.join("\n")));
      }
      if (refStatus.last_error) statusBox.appendChild(el("pre", "hse_code", String(refStatus.last_error)));
      refCard.appendChild(statusBox);
    }

    const rowRef = el("div", "hse_toolbar");

    const selectRef = document.createElement("select");
    selectRef.className = "hse_input";

    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "(Aucune)";
    selectRef.appendChild(optNone);

    for (const c of candidates) {
      const opt = document.createElement("option");
      opt.value = c.entity_id;
      const label = `${c.name || c.entity_id} (${c.entity_id})`;
      opt.textContent = label;
      selectRef.appendChild(opt);
    }

    const selectedRef = model.selected_reference_entity_id || "";
    selectRef.value = selectedRef;
    selectRef.addEventListener("change", () => on_action("select_reference", selectRef.value || null));

    rowRef.appendChild(selectRef);
    refCard.appendChild(rowRef);

    if (model.message) {
      refCard.appendChild(el("div", "hse_subtitle", model.message));
    }

    if (model.reference_status_error) {
      refCard.appendChild(el("pre", "hse_code", String(model.reference_status_error)));
    }

    if (model.error) {
      refCard.appendChild(el("pre", "hse_code", String(model.error)));
    }

    // 3) Cost entities panel
    const costCard = el("div", "hse_card");
    costCard.appendChild(el("div", null, "Capteurs utilisés pour le calcul"));
    costCard.appendChild(
      el(
        "div",
        "hse_subtitle",
        "Sélectionne les capteurs dont la consommation sera agrégée pour estimer les coûts."
      )
    );

    if (effectiveRef) {
      costCard.appendChild(el("div", "hse_subtitle", `Capteur de référence exclu: ${effectiveRef}`));
    }

    if (hadRefConflict) {
      const badges = el("div", "hse_badges");
      badges.appendChild(el("span", "hse_badge hse_badge_warn", "Garde-fou: la référence est exclue des calculs"));
      costCard.appendChild(badges);
    }

    // Smart auto-selection: use server suggestion if available
    const autoCard = el("div", "hse_card hse_card_inner");
    autoCard.appendChild(el("div", null, "Sélection automatique intelligente"));
    autoCard.appendChild(
      el(
        "div",
        "hse_subtitle",
        "Le système choisit 1 seul capteur power (W/kW) par appareil (device_id) pour éviter les doublons."
      )
    );

    const btnAuto = el("button", "hse_button hse_button_primary", "Lancer la sélection automatique");
    btnAuto.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnAuto.addEventListener("click", () => {
      const suggestedRaw = Array.isArray(model.scan_result?.suggested_cost_entity_ids)
        ? model.scan_result.suggested_cost_entity_ids
        : [];

      let picked = suggestedRaw.slice();
      if (effectiveRef) picked = picked.filter((x) => x !== effectiveRef);
      picked = Array.from(new Set(picked)).sort((a, b) => String(a).localeCompare(String(b)));

      on_action("cost_auto_select", { entity_ids: picked });
    });

    autoCard.appendChild(btnAuto);

    const sugSummary = model.scan_result?.suggested_summary;
    if (sugSummary && typeof sugSummary === "object") {
      const line = `suggestion: ${sugSummary.suggested_count ?? "?"} (groups: ${sugSummary.considered_groups ?? "?"}, power sans device_id: ${
        sugSummary.skipped_power_no_device_id ?? "?"
      })`;
      autoCard.appendChild(el("div", "hse_subtitle", line));
    }

    costCard.appendChild(autoCard);

    // Filter
    const filterRow = el("div", "hse_toolbar");
    const input = document.createElement("input");
    input.className = "hse_input";
    input.placeholder = "Filtrer (entity_id, nom, intégration, unit, state…)";
    input.value = filter_q;
    input.addEventListener("input", (ev) => on_action("cost_filter", ev.target.value));
    filterRow.appendChild(input);
    costCard.appendChild(filterRow);

    const grid = el("div", "hse_grid_2col");

    const left = el("div", "hse_card hse_card_inner");
    const avail = _filter_candidates(candidatesForCost.filter((c) => !selectedSet.has(c.entity_id)), filter_q);

    const right = el("div", "hse_card hse_card_inner");

    const selectedOk = _filter_candidates(
      candidatesForCost
        .filter((c) => selectedSet.has(c.entity_id))
        .sort((a, b) => String(a.name || a.entity_id || "").localeCompare(String(b.name || b.entity_id || ""))),
      filter_q
    );

    const selectedNotOk = _filter_candidates(
      selectedIds
        .map((eid) => allById.get(eid))
        .filter((c) => c && !selectedOk.some((x) => x.entity_id === c.entity_id)),
      filter_q
    );

    const selectedUnknown = selectedIds.filter((eid) => !allById.get(eid));

    const availGroups = _group_by_integration(avail);
    const selGroupsOk = _group_by_integration(selectedOk);
    const selGroupsNotOk = _group_by_integration(selectedNotOk);

    const _dup_badge = (c) => {
      const gk = _group_key(c);
      if (!gk) return null;
      const meta = group_meta.get(gk);
      if (!meta) return null;
      const blockedBy = selectedByGroup.get(gk);
      const badge = el("span", "hse_badge hse_badge_warn", "doublon");
      badge.title = `Doublon détecté (${meta.size}). Best: ${meta.best_entity_id}`;
      if (blockedBy && blockedBy !== c.entity_id) badge.title = `Doublon: déjà sélectionné (${blockedBy})`;
      return badge;
    };

    _render_candidate_groups(left, availGroups, {
      clear: true,
      prepend: [el("div", null, `Disponibles (${avail.length})`)],
      open_by_default: false,
      get_dup_badge: _dup_badge,
      make_action_button: (c) => {
        const gk = _group_key(c);
        const meta = gk ? group_meta.get(gk) : null;
        const blockedBy = gk ? selectedByGroup.get(gk) : null;

        if (meta && blockedBy && blockedBy !== c.entity_id) {
          const b = el("button", "hse_button", "Remplacer");
          b.title = `Remplace ${blockedBy} par ${c.entity_id}`;
          b.addEventListener("click", () => on_action("pricing_list_replace", { from_entity_id: blockedBy, to_entity_id: c.entity_id }));
          return b;
        }

        return _mk_button("Ajouter", () => on_action("pricing_list_add", { entity_id: c.entity_id }));
      },
    });

    _render_candidate_groups(right, selGroupsOk, {
      clear: true,
      prepend: [el("div", null, `Sélectionnés (${selectedIds.length})`)],
      open_by_default: false,
      get_dup_badge: _dup_badge,
      make_action_button: (c) => _mk_button("Retirer", () => on_action("pricing_list_remove", { entity_id: c.entity_id })),
    });

    if (selectedNotOk.length) {
      _render_candidate_groups(right, selGroupsNotOk, {
        clear: false,
        prepend: [
          el("div", "hse_section_title", `Sélectionnés (non OK) (${selectedNotOk.length})`),
          el(
            "div",
            "hse_subtitle",
            "Ces capteurs sont bien enregistrés dans ta sélection, mais ils sont indisponibles/invalides selon le scan (status/state)."
          ),
        ],
        open_by_default: false,
        get_dup_badge: _dup_badge,
        make_action_button: (c) => _mk_button("Retirer", () => on_action("pricing_list_remove", { entity_id: c.entity_id })),
      });
    }

    if (selectedUnknown.length) {
      const card = el("div", "hse_card hse_card_inner");
      card.appendChild(el("div", "hse_section_title", `Sélectionnés (introuvables) (${selectedUnknown.length})`));
      card.appendChild(
        el(
          "div",
          "hse_subtitle",
          "Ces entity_id ne sont pas trouvés dans le scan actuel (renommés, supprimés, intégration inactive…)."
        )
      );
      card.appendChild(el("pre", "hse_code", selectedUnknown.join("\n")));
      right.appendChild(card);
    }

    grid.appendChild(left);
    grid.appendChild(right);
    costCard.appendChild(grid);

    // Duplicate summary (power + energy, informational)
    const dupCard = el("div", "hse_card hse_card_inner");
    const dupDetails = document.createElement("details");
    dupDetails.className = "hse_fold";

    const dupSum = document.createElement("summary");
    dupSum.className = "hse_fold_summary";

    const dupLeft = el("div", "hse_fold_left");
    dupLeft.appendChild(el("div", "hse_fold_title", "Doublons détectés"));

    let powerDup = 0;
    let energyDup = 0;
    for (const [, items] of by_group.entries()) {
      if (!items || items.length <= 1) continue;
      const kind = String(items[0]?.kind || "");
      if (kind === "power") powerDup += 1;
      else if (kind === "energy") energyDup += 1;
    }

    const dupRight = el("div", "hse_badges");
    dupRight.appendChild(el("span", "hse_badge", `power groups: ${powerDup}`));
    dupRight.appendChild(el("span", "hse_badge", `energy groups: ${energyDup}`));

    dupSum.appendChild(dupLeft);
    dupSum.appendChild(dupRight);

    const dupBody = el("div", "hse_fold_body");

    const _render_dup_kind = (kind) => {
      const groups = [];
      for (const [gk, items] of by_group.entries()) {
        if (!items || items.length <= 1) continue;
        if (String(items[0]?.kind || "") !== kind) continue;
        groups.push({ gk, items });
      }
      groups.sort((a, b) => a.gk.localeCompare(b.gk));

      const box = el("div");
      box.appendChild(el("div", "hse_section_title", kind === "power" ? "Doublons Power" : "Doublons Energy"));
      if (!groups.length) {
        box.appendChild(el("div", "hse_subtitle", "Aucun."));
        return box;
      }

      const rows = [];
      for (const g of groups) {
        const meta = group_meta.get(g.gk);
        const label = meta?.best_entity_id ? `best: ${meta.best_entity_id}` : "";
        rows.push({
          key: g.gk,
          label,
          items: g.items
            .map((c) => `${c.integration_domain || "?"}: ${c.entity_id}`)
            .sort((a, b) => a.localeCompare(b))
            .join("\n"),
        });
      }

      box.appendChild(
        _mk_table(rows, [
          { label: "Groupe", value: (r) => el("span", "hse_mono", r.key) },
          { label: "Choix", value: (r) => r.label },
          { label: "Capteurs", value: (r) => el("pre", "hse_code", r.items) },
        ])
      );

      return box;
    };

    dupBody.appendChild(_render_dup_kind("power"));
    dupBody.appendChild(_render_dup_kind("energy"));

    dupDetails.appendChild(dupSum);
    dupDetails.appendChild(dupBody);

    dupCard.appendChild(dupDetails);
    costCard.appendChild(dupCard);

    // Optional shortcut: save pricing+capteurs from this panel too
    const costToolbar = el("div", "hse_toolbar");
    const btnSave2 = el(
      "button",
      "hse_button hse_button_primary",
      model.pricing_saving ? "Sauvegarde…" : "Sauvegarder (tarifs + capteurs)"
    );
    btnSave2.disabled = !!model.loading || !!model.saving || !!model.pricing_saving;
    btnSave2.addEventListener("click", () => {
      btnSave2.disabled = true;
      btnSave2.textContent = "Sauvegarde…";
      on_action("pricing_save");
    });
    costToolbar.appendChild(btnSave2);
    costCard.appendChild(costToolbar);

    container.appendChild(headerCard);
    container.appendChild(pricingCard);
    container.appendChild(refCard);
    container.appendChild(costCard);
  }

  window.hse_config_view = { render_config, _current_reference_entity_id, _reference_status_from_catalogue };
})();
