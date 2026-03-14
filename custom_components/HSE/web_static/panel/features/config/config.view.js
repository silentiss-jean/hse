/*
HSE_DOC: custom_components/hse/docs/config_ui.md
HSE_MAINTENANCE: If you change UI semantics here, update the doc above.
*/

(function () {
  const { el, clear } = window.hse_dom;

  // ---------------------------------------------------------------------------
  // PATCH-DOM STRATEGY (Option B)
  // render_config() ne fait plus de clear(container) total.
  // Au premier appel (container vide) → construction complète avec data-hse-*
  //   attributes sur les nœuds dynamiques.
  // Aux appels suivants (polling statut référence toutes les 4s) → seuls les
  //   nœuds portant data-hse-live="<key>" sont mis à jour en place.
  //   Le <select> référence et les <input> restent dans le DOM → leur état
  //   natif (dropdown ouvert, focus, valeur en cours de saisie) est préservé.
  //
  // FIX-5: cost-card en patch partiel.
  //   _patch_cost_card() ne fait plus de clear() global. Elle met à jour
  //   uniquement les nœuds live (compteurs, boutons disabled) et préserve
  //   l'état open/fermé de tous les <details> de la cost-card.
  //   Un rebuild complet reste déclenché uniquement si la liste des
  //   candidats sélectionnés a réellement changé (ajout/retrait/auto-select)
  //   ou si le filtre texte a changé — dans ce cas on restaure l'état open
  //   avant de reconstruire.
  //
  // FIX-6: doublons dans Disponibles.
  //   La liste Disponibles n'affiche plus qu'un seul candidat par groupe de
  //   doublons (le best_entity_id). Les autres membres du groupe sont masqués
  //   SAUF si un membre du groupe est déjà sélectionné : dans ce cas ils
  //   restent visibles avec le bouton "Remplacer".
  // ---------------------------------------------------------------------------

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
    if (integ === "tplink") s += 2;
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
      // Restaurer l'état open depuis opts.open_state si disponible, sinon open_by_default
      const restored_open = opts?.open_state?.get(g.integration_domain);
      details.open = restored_open != null ? restored_open : (opts?.open_by_default === true);

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

  // ---------------------------------------------------------------------------
  // _snapshot_open_state(container)
  // Retourne une Map<clé, bool> de l'état open de tous les <details> dans
  // container. La clé est le texte du .hse_fold_title ou le className en
  // fallback. Utilisé pour restaurer l'état après un rebuild.
  // ---------------------------------------------------------------------------
  function _snapshot_open_state(container) {
    const map = new Map();
    for (const d of container.querySelectorAll("details")) {
      const title = d.querySelector(".hse_fold_title")?.textContent ||
                    d.querySelector("summary")?.textContent ||
                    d.className;
      map.set(title, d.open);
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // _patch_live(container, key, render_fn)
  // ---------------------------------------------------------------------------
  function _patch_live(container, key, render_fn) {
    const existing = container.querySelector(`[data-hse-live="${key}"]`);
    if (!existing) {
      const node = render_fn();
      if (node) {
        node.dataset.hseLive = key;
        container.appendChild(node);
      }
      return;
    }

    const tag = existing.tagName.toLowerCase();
    if ((tag === "select" || tag === "input") && document.activeElement === existing) {
      return;
    }
    if (existing.contains(document.activeElement)) {
      return;
    }

    const next = render_fn();
    if (!next) {
      existing.remove();
      return;
    }
    next.dataset.hseLive = key;
    existing.replaceWith(next);
  }

  function _patch_select_options(sel, options, value) {
    const current_values = Array.from(sel.options).map((o) => o.value);
    const next_values = options.map((o) => o.value);
    const same = current_values.length === next_values.length && current_values.every((v, i) => v === next_values[i]);
    if (!same) {
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
    }
    if (document.activeElement !== sel) {
      sel.value = value || "";
    }
  }

  // ---------------------------------------------------------------------------
  // render_config — point d'entrée principal
  // ---------------------------------------------------------------------------
  function render_config(container, model, on_action) {
    const is_first_render = !container.hasAttribute("data-hse-config-built");

    if (is_first_render) {
      _build_config(container, model, on_action);
      container.setAttribute("data-hse-config-built", "1");
    } else {
      _patch_config(container, model, on_action);
    }
  }

  // ---------------------------------------------------------------------------
  // _build_config — construction initiale complète (une seule fois)
  // ---------------------------------------------------------------------------
  function _build_config(container, model, on_action) {
    clear(container);

    const candidates = _power_candidates(model.scan_result);
    const effectiveRef = model.selected_reference_entity_id || model.current_reference_entity_id || null;

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
    container.appendChild(headerCard);

    const pricingCard = el("div", "hse_card");
    pricingCard.dataset.hseSection = "pricing";
    _build_pricing_card(pricingCard, model, on_action);
    container.appendChild(pricingCard);

    const refCard = el("div", "hse_card");
    refCard.dataset.hseSection = "reference";
    _build_ref_card(refCard, model, candidates, effectiveRef, on_action);
    container.appendChild(refCard);

    const costCard = el("div", "hse_card");
    costCard.dataset.hseSection = "cost";
    _build_cost_card(costCard, model, candidates, effectiveRef, on_action, null);
    container.appendChild(costCard);
  }

  // ---------------------------------------------------------------------------
  // _patch_config — mise à jour ciblée sans reconstruire les interactifs
  // ---------------------------------------------------------------------------
  function _patch_config(container, model, on_action) {
    const candidates = _power_candidates(model.scan_result);
    const draft = model.pricing_draft || model.pricing || model.pricing_defaults || {};
    const effectiveRef = model.selected_reference_entity_id || model.current_reference_entity_id || null;
    const refStatus = model.reference_status || _reference_status_from_catalogue(model.catalogue, effectiveRef);
    const savedPricing = model.pricing || null;
    const contractType = _get(draft, "contract_type", "fixed");
    const busy = !!model.loading || !!model.saving || !!model.pricing_saving;

    // -- pricing card --
    const pricingCard = container.querySelector('[data-hse-section="pricing"]');
    if (pricingCard) {
      const prevContract = pricingCard.dataset.hseContractType || "";
      if (prevContract !== contractType) {
        clear(pricingCard);
        pricingCard.dataset.hseContractType = contractType;
        _build_pricing_card(pricingCard, model, on_action);
      } else {
        const savedLine = pricingCard.querySelector('[data-hse-live="pricing-saved-line"]');
        if (savedLine) {
          savedLine.textContent = savedPricing?.updated_at
            ? `Tarifs enregistrés (updated_at): ${savedPricing.updated_at}`
            : "Tarifs enregistrés: (aucun)";
        }
        for (const btn of pricingCard.querySelectorAll("button")) {
          btn.disabled = busy;
        }
        _patch_live(pricingCard, "pricing-message", () =>
          model.pricing_message ? el("div", "hse_subtitle", model.pricing_message) : null
        );
        _patch_live(pricingCard, "pricing-error", () =>
          model.pricing_error ? el("pre", "hse_code", String(model.pricing_error)) : null
        );
      }
    }

    // -- reference card --
    const refCard = container.querySelector('[data-hse-section="reference"]');
    if (refCard) {
      const refLine = refCard.querySelector('[data-hse-live="ref-current-line"]');
      if (refLine) {
        refLine.textContent = `Référence actuelle: ${model.current_reference_entity_id || "(Aucune référence sélectionnée)"}`;
      }
      _patch_live(refCard, "ref-status-box", () => _build_ref_status_box(refStatus));
      const selectRef = refCard.querySelector('[data-hse-live="ref-select"]');
      if (selectRef) {
        const opts = _ref_select_options(candidates);
        _patch_select_options(selectRef, opts, model.selected_reference_entity_id || "");
      }
      _patch_live(refCard, "ref-message", () =>
        model.message ? el("div", "hse_subtitle", model.message) : null
      );
      _patch_live(refCard, "ref-status-error", () =>
        model.reference_status_error ? el("pre", "hse_code", String(model.reference_status_error)) : null
      );
      _patch_live(refCard, "ref-error", () =>
        model.error ? el("pre", "hse_code", String(model.error)) : null
      );
      for (const btn of refCard.querySelectorAll("button")) {
        btn.disabled = busy;
      }
    }

    // -- cost card : patch partiel (FIX-5) --
    const costCard = container.querySelector('[data-hse-section="cost"]');
    if (costCard) {
      _patch_cost_card(costCard, model, candidates, effectiveRef, on_action);
    }
  }

  // ---------------------------------------------------------------------------
  // _patch_cost_card — mise à jour partielle de la cost-card
  //
  // Détermine si un rebuild est nécessaire en comparant une signature
  // (selectedIds + filter_q + effectiveRef) avec celle du rendu précédent.
  // - Pas de changement → patch uniquement les boutons busy + compteurs.
  // - Changement → snapshot open state → rebuild → restaure open state.
  // ---------------------------------------------------------------------------
  function _patch_cost_card(card, model, candidates, effectiveRef, on_action) {
    const draft = model.pricing_draft || model.pricing || model.pricing_defaults || {};
    const busy = !!model.loading || !!model.saving || !!model.pricing_saving;
    const filter_q = model.cost_filter_q || "";

    const selectedIdsRaw = Array.isArray(_get(draft, "cost_entity_ids", []))
      ? _get(draft, "cost_entity_ids", []) : [];
    const selectedIds = effectiveRef
      ? selectedIdsRaw.filter((x) => x !== effectiveRef)
      : selectedIdsRaw.slice();

    // Signature de l'état courant
    const sig = JSON.stringify(selectedIds.slice().sort()) +
      "|" + (effectiveRef || "") +
      "|" + filter_q;

    const prev_sig = card.dataset.hseCostSig || null;

    if (prev_sig === sig) {
      // Rien de structurel n'a changé → juste mettre à jour busy + compteurs
      for (const btn of card.querySelectorAll("button")) {
        btn.disabled = busy;
      }
      // Mettre à jour le compteur "Disponibles" et "Sélectionnés" si présents
      _patch_live(card, "cost-avail-count", () => null); // pas de nœud dédié pour l'instant
      return;
    }

    // Changement structurel → snapshot état open → rebuild → restaurer
    const open_state = _snapshot_open_state(card);
    clear(card);
    _build_cost_card(card, model, candidates, effectiveRef, on_action, open_state);
    card.dataset.hseCostSig = sig;
  }

  // ---------------------------------------------------------------------------
  // Helpers de construction des sections
  // ---------------------------------------------------------------------------

  function _ref_select_options(candidates) {
    const opts = [{ value: "", label: "(Aucune)" }];
    for (const c of candidates) {
      opts.push({ value: c.entity_id, label: `${c.name || c.entity_id} (${c.entity_id})` });
    }
    return opts;
  }

  function _build_ref_status_box(refStatus) {
    if (!refStatus) return null;
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
    return statusBox;
  }

  function _build_pricing_card(card, model, on_action) {
    const savedPricing = model.pricing || null;
    const draft = model.pricing_draft || model.pricing || model.pricing_defaults || {};
    const contractType = _get(draft, "contract_type", "fixed");
    const displayMode = _get(draft, "display_mode", "ttc");
    const busy = !!model.loading || !!model.saving || !!model.pricing_saving;

    card.dataset.hseContractType = contractType;

    card.appendChild(el("div", null, "Contrat / Tarifs"));
    card.appendChild(
      el("div", "hse_subtitle", "Renseigne HT et TTC (on ne déduit jamais la TVA). Les heures creuses sont configurables (défaut 22:00 → 06:00).")
    );

    const savedLine = el("div", "hse_subtitle");
    savedLine.dataset.hseLive = "pricing-saved-line";
    savedLine.textContent = savedPricing?.updated_at
      ? `Tarifs enregistrés (updated_at): ${savedPricing.updated_at}`
      : "Tarifs enregistrés: (aucun)";
    card.appendChild(savedLine);

    const rowType = el("div", "hse_toolbar");
    rowType.appendChild(el("div", "hse_subtitle", "Type de contrat"));
    rowType.appendChild(_mk_select(
      [{ value: "fixed", label: "Prix fixe" }, { value: "hphc", label: "HP / HC" }],
      contractType,
      (v) => on_action("pricing_patch", { path: "contract_type", value: v })
    ));
    rowType.appendChild(el("div", "hse_subtitle", "Mode d'affichage"));
    rowType.appendChild(_mk_select(
      [{ value: "ttc", label: "TTC" }, { value: "ht", label: "HT" }],
      displayMode,
      (v) => on_action("pricing_patch", { path: "display_mode", value: v })
    ));
    card.appendChild(rowType);

    const rowSub = el("div", "hse_toolbar");
    rowSub.appendChild(el("div", "hse_subtitle", "Abonnement mensuel HT"));
    rowSub.appendChild(_mk_number(_get(draft, "subscription_monthly.ht", ""), "0.01", (v) =>
      on_action("pricing_patch", { path: "subscription_monthly.ht", value: v, no_render: true })
    ));
    rowSub.appendChild(el("div", "hse_subtitle", "Abonnement mensuel TTC"));
    rowSub.appendChild(_mk_number(_get(draft, "subscription_monthly.ttc", ""), "0.01", (v) =>
      on_action("pricing_patch", { path: "subscription_monthly.ttc", value: v, no_render: true })
    ));
    card.appendChild(rowSub);

    if (contractType === "fixed") {
      const rowFixed = el("div", "hse_toolbar");
      rowFixed.appendChild(el("div", "hse_subtitle", "Prix énergie (€/kWh) HT"));
      rowFixed.appendChild(_mk_number(_get(draft, "fixed_energy_per_kwh.ht", ""), "0.0001", (v) =>
        on_action("pricing_patch", { path: "fixed_energy_per_kwh.ht", value: v, no_render: true })
      ));
      rowFixed.appendChild(el("div", "hse_subtitle", "Prix énergie (€/kWh) TTC"));
      rowFixed.appendChild(_mk_number(_get(draft, "fixed_energy_per_kwh.ttc", ""), "0.0001", (v) =>
        on_action("pricing_patch", { path: "fixed_energy_per_kwh.ttc", value: v, no_render: true })
      ));
      card.appendChild(rowFixed);
    } else {
      const rowHP = el("div", "hse_toolbar");
      rowHP.appendChild(el("div", "hse_subtitle", "Prix HP (€/kWh) HT"));
      rowHP.appendChild(_mk_number(_get(draft, "hp_energy_per_kwh.ht", ""), "0.0001", (v) =>
        on_action("pricing_patch", { path: "hp_energy_per_kwh.ht", value: v, no_render: true })
      ));
      rowHP.appendChild(el("div", "hse_subtitle", "Prix HP (€/kWh) TTC"));
      rowHP.appendChild(_mk_number(_get(draft, "hp_energy_per_kwh.ttc", ""), "0.0001", (v) =>
        on_action("pricing_patch", { path: "hp_energy_per_kwh.ttc", value: v, no_render: true })
      ));
      card.appendChild(rowHP);

      const rowHC = el("div", "hse_toolbar");
      rowHC.appendChild(el("div", "hse_subtitle", "Prix HC (€/kWh) HT"));
      rowHC.appendChild(_mk_number(_get(draft, "hc_energy_per_kwh.ht", ""), "0.0001", (v) =>
        on_action("pricing_patch", { path: "hc_energy_per_kwh.ht", value: v, no_render: true })
      ));
      rowHC.appendChild(el("div", "hse_subtitle", "Prix HC (€/kWh) TTC"));
      rowHC.appendChild(_mk_number(_get(draft, "hc_energy_per_kwh.ttc", ""), "0.0001", (v) =>
        on_action("pricing_patch", { path: "hc_energy_per_kwh.ttc", value: v, no_render: true })
      ));
      card.appendChild(rowHC);

      const rowSched = el("div", "hse_toolbar");
      rowSched.appendChild(el("div", "hse_subtitle", "Heures creuses start"));
      rowSched.appendChild(_mk_time(_get(draft, "hc_schedule.start", "22:00"), (v) =>
        on_action("pricing_patch", { path: "hc_schedule.start", value: v, no_render: true })
      ));
      rowSched.appendChild(el("div", "hse_subtitle", "Heures creuses end"));
      rowSched.appendChild(_mk_time(_get(draft, "hc_schedule.end", "06:00"), (v) =>
        on_action("pricing_patch", { path: "hc_schedule.end", value: v, no_render: true })
      ));
      card.appendChild(rowSched);
    }

    const pricingToolbar = el("div", "hse_toolbar");
    const btnPricingSave = el("button", "hse_button hse_button_primary",
      model.pricing_saving ? "Sauvegarde…" : "Sauvegarder tarifs (incl. capteurs)"
    );
    btnPricingSave.disabled = busy;
    btnPricingSave.addEventListener("click", () => {
      btnPricingSave.disabled = true;
      btnPricingSave.textContent = "Sauvegarde…";
      on_action("pricing_save");
    });
    const btnPricingClear = el("button", "hse_button", "Effacer tarifs");
    btnPricingClear.disabled = busy;
    btnPricingClear.addEventListener("click", () => on_action("pricing_clear"));
    pricingToolbar.appendChild(btnPricingSave);
    pricingToolbar.appendChild(btnPricingClear);
    card.appendChild(pricingToolbar);

    if (model.pricing_message) {
      const n = el("div", "hse_subtitle", model.pricing_message);
      n.dataset.hseLive = "pricing-message";
      card.appendChild(n);
    }
    if (model.pricing_error) {
      const n = el("pre", "hse_code", String(model.pricing_error));
      n.dataset.hseLive = "pricing-error";
      card.appendChild(n);
    }
  }

  function _build_ref_card(card, model, candidates, effectiveRef, on_action) {
    const busy = !!model.loading || !!model.saving || !!model.pricing_saving;
    const refStatus = model.reference_status || _reference_status_from_catalogue(model.catalogue, effectiveRef);

    card.appendChild(el("div", null, "Capteur de référence (compteur total)"));
    card.appendChild(
      el("div", "hse_subtitle",
        "Le capteur de référence est indépendant: il sert de vérité terrain des coûts (comparaison), et ne peut pas être inclus dans les capteurs de calcul."
      )
    );

    const refToolbar = el("div", "hse_toolbar");
    const btnRefresh = el("button", "hse_button", model.loading ? "Chargement…" : "Rafraîchir");
    btnRefresh.disabled = busy;
    btnRefresh.addEventListener("click", () => on_action("refresh"));
    const btnSave = el("button", "hse_button hse_button_primary", model.saving ? "Sauvegarde…" : "Sauvegarder");
    btnSave.disabled = busy;
    btnSave.addEventListener("click", () => on_action("save_reference"));
    const btnClear = el("button", "hse_button", "Supprimer la référence");
    btnClear.disabled = busy;
    btnClear.addEventListener("click", () => on_action("clear_reference"));
    refToolbar.appendChild(btnRefresh);
    refToolbar.appendChild(btnSave);
    refToolbar.appendChild(btnClear);
    card.appendChild(refToolbar);

    const refLine = el("div", "hse_subtitle");
    refLine.dataset.hseLive = "ref-current-line";
    refLine.textContent = `Référence actuelle: ${model.current_reference_entity_id || "(Aucune référence sélectionnée)"}`;
    card.appendChild(refLine);

    if (refStatus) {
      const statusBox = _build_ref_status_box(refStatus);
      if (statusBox) {
        statusBox.dataset.hseLive = "ref-status-box";
        card.appendChild(statusBox);
      }
    } else {
      const placeholder = document.createElement("span");
      placeholder.dataset.hseLive = "ref-status-box";
      placeholder.style.display = "none";
      card.appendChild(placeholder);
    }

    const rowRef = el("div", "hse_toolbar");
    const selectRef = document.createElement("select");
    selectRef.className = "hse_input";
    selectRef.dataset.hseLive = "ref-select";
    for (const opt of _ref_select_options(candidates)) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      selectRef.appendChild(o);
    }
    selectRef.value = model.selected_reference_entity_id || "";
    selectRef.addEventListener("change", () => on_action("select_reference", selectRef.value || null));
    rowRef.appendChild(selectRef);
    card.appendChild(rowRef);

    if (model.message) {
      const n = el("div", "hse_subtitle", model.message);
      n.dataset.hseLive = "ref-message";
      card.appendChild(n);
    }
    if (model.reference_status_error) {
      const n = el("pre", "hse_code", String(model.reference_status_error));
      n.dataset.hseLive = "ref-status-error";
      card.appendChild(n);
    }
    if (model.error) {
      const n = el("pre", "hse_code", String(model.error));
      n.dataset.hseLive = "ref-error";
      card.appendChild(n);
    }
  }

  // open_state: Map<titre, bool> optionnelle pour restaurer l'état des <details>
  function _build_cost_card(card, model, candidates, effectiveRef, on_action, open_state) {
    const draft = model.pricing_draft || model.pricing || model.pricing_defaults || {};
    const busy = !!model.loading || !!model.saving || !!model.pricing_saving;
    const filter_q = model.cost_filter_q || "";

    const selectedIdsRaw = Array.isArray(_get(draft, "cost_entity_ids", [])) ? _get(draft, "cost_entity_ids", []) : [];
    const selectedIds = effectiveRef ? selectedIdsRaw.filter((x) => x !== effectiveRef) : selectedIdsRaw.slice();
    const selectedSet = new Set(selectedIds);
    const hadRefConflict = !!(effectiveRef && selectedIdsRaw.includes(effectiveRef));
    const candidatesForCost = effectiveRef ? candidates.filter((c) => c.entity_id !== effectiveRef) : candidates;

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
      if (!selectedByGroup.has(gk)) selectedByGroup.set(gk, eid);
    }

    card.appendChild(el("div", null, "Capteurs utilisés pour le calcul"));
    card.appendChild(el("div", "hse_subtitle", "Sélectionne les capteurs dont la consommation sera agrégée pour estimer les coûts."));

    if (effectiveRef) card.appendChild(el("div", "hse_subtitle", `Capteur de référence exclu: ${effectiveRef}`));
    if (hadRefConflict) {
      const badges = el("div", "hse_badges");
      badges.appendChild(el("span", "hse_badge hse_badge_warn", "Garde-fou: la référence est exclue des calculs"));
      card.appendChild(badges);
    }

    const autoCard = el("div", "hse_card hse_card_inner");
    autoCard.appendChild(el("div", null, "Sélection automatique intelligente"));
    autoCard.appendChild(el("div", "hse_subtitle", "Le système choisit 1 seul capteur power (W/kW) par appareil (device_id) pour éviter les doublons."));
    const btnAuto = el("button", "hse_button hse_button_primary", "Lancer la sélection automatique");
    btnAuto.disabled = busy;
    btnAuto.addEventListener("click", () => {
      const suggestedRaw = Array.isArray(model.scan_result?.suggested_cost_entity_ids)
        ? model.scan_result.suggested_cost_entity_ids : [];
      let picked = suggestedRaw.slice();
      if (effectiveRef) picked = picked.filter((x) => x !== effectiveRef);
      picked = Array.from(new Set(picked)).sort((a, b) => String(a).localeCompare(String(b)));
      on_action("cost_auto_select", { entity_ids: picked });
    });
    autoCard.appendChild(btnAuto);
    const sugSummary = model.scan_result?.suggested_summary;
    if (sugSummary && typeof sugSummary === "object") {
      autoCard.appendChild(el("div", "hse_subtitle",
        `suggestion: ${sugSummary.suggested_count ?? "?"} (groups: ${sugSummary.considered_groups ?? "?"}, power sans device_id: ${sugSummary.skipped_power_no_device_id ?? "?"})`
      ));
    }
    card.appendChild(autoCard);

    const filterRow = el("div", "hse_toolbar");
    const input = document.createElement("input");
    input.className = "hse_input";
    input.placeholder = "Filtrer (entity_id, nom, intégration, unit, state…)";
    input.value = filter_q;
    input.addEventListener("input", (ev) => on_action("cost_filter", ev.target.value));
    filterRow.appendChild(input);
    card.appendChild(filterRow);

    const grid = el("div", "hse_grid_2col");
    const left = el("div", "hse_card hse_card_inner");
    const right = el("div", "hse_card hse_card_inner");

    // ── FIX-6 : dans Disponibles, masquer les doublons non-best
    // SAUF si un membre du groupe est déjà sélectionné (dans ce cas on garde
    // tous les membres non-sélectionnés pour permettre le remplacement).
    const availRaw = candidatesForCost.filter((c) => !selectedSet.has(c.entity_id));
    const avail = _filter_candidates(
      availRaw.filter((c) => {
        const gk = _group_key(c);
        if (!gk) return true; // pas de device_id → pas de groupe → toujours visible
        const meta = group_meta.get(gk);
        if (!meta) return true; // groupe singleton → toujours visible
        // Si un membre du groupe est déjà sélectionné, on garde tous les
        // non-sélectionnés pour permettre le bouton "Remplacer"
        if (selectedByGroup.has(gk)) return true;
        // Sinon : n'afficher que le best du groupe
        return c.entity_id === meta.best_entity_id;
      }),
      filter_q
    );

    const selectedOk = _filter_candidates(
      candidatesForCost.filter((c) => selectedSet.has(c.entity_id))
        .sort((a, b) => String(a.name || a.entity_id || "").localeCompare(String(b.name || b.entity_id || ""))),
      filter_q
    );
    const selectedNotOk = _filter_candidates(
      selectedIds.map((eid) => allById.get(eid)).filter((c) => c && !selectedOk.some((x) => x.entity_id === c.entity_id)),
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
      open_state,
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
      open_state,
      get_dup_badge: _dup_badge,
      make_action_button: (c) => _mk_button("Retirer", () => on_action("pricing_list_remove", { entity_id: c.entity_id })),
    });

    if (selectedNotOk.length) {
      _render_candidate_groups(right, selGroupsNotOk, {
        clear: false,
        prepend: [
          el("div", "hse_section_title", `Sélectionnés (non OK) (${selectedNotOk.length})`),
          el("div", "hse_subtitle", "Ces capteurs sont bien enregistrés dans ta sélection, mais ils sont indisponibles/invalides selon le scan (status/state)."),
        ],
        open_by_default: false,
        open_state,
        get_dup_badge: _dup_badge,
        make_action_button: (c) => _mk_button("Retirer", () => on_action("pricing_list_remove", { entity_id: c.entity_id })),
      });
    }

    if (selectedUnknown.length) {
      const unknownCard = el("div", "hse_card hse_card_inner");
      unknownCard.appendChild(el("div", "hse_section_title", `Sélectionnés (introuvables) (${selectedUnknown.length})`));
      unknownCard.appendChild(el("div", "hse_subtitle", "Ces entity_id ne sont pas trouvés dans le scan actuel (renommés, supprimés, intégration inactive…)."));
      unknownCard.appendChild(el("pre", "hse_code", selectedUnknown.join("\n")));
      right.appendChild(unknownCard);
    }

    grid.appendChild(left);
    grid.appendChild(right);
    card.appendChild(grid);

    // Doublons détectés
    const dupCard = el("div", "hse_card hse_card_inner");
    const dupDetails = document.createElement("details");
    dupDetails.className = "hse_fold";
    // Restaurer l'état open du bloc doublons
    dupDetails.open = open_state?.get("Doublons détectés") ?? false;
    const dupSum = document.createElement("summary");
    dupSum.className = "hse_fold_summary";
    const dupLeft = el("div", "hse_fold_left");
    dupLeft.appendChild(el("div", "hse_fold_title", "Doublons détectés"));
    let powerDup = 0, energyDup = 0;
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
      if (!groups.length) { box.appendChild(el("div", "hse_subtitle", "Aucun.")); return box; }
      const rows = [];
      for (const g of groups) {
        const meta = group_meta.get(g.gk);
        rows.push({
          key: g.gk,
          label: meta?.best_entity_id ? `best: ${meta.best_entity_id}` : "",
          items: g.items.map((c) => `${c.integration_domain || "?"}: ${c.entity_id}`).sort((a, b) => a.localeCompare(b)).join("\n"),
        });
      }
      box.appendChild(_mk_table(rows, [
        { label: "Groupe", value: (r) => el("span", "hse_mono", r.key) },
        { label: "Choix", value: (r) => r.label },
        { label: "Capteurs", value: (r) => el("pre", "hse_code", r.items) },
      ]));
      return box;
    };
    dupBody.appendChild(_render_dup_kind("power"));
    dupBody.appendChild(_render_dup_kind("energy"));
    dupDetails.appendChild(dupSum);
    dupDetails.appendChild(dupBody);
    dupCard.appendChild(dupDetails);
    card.appendChild(dupCard);

    const costToolbar = el("div", "hse_toolbar");
    const btnSave2 = el("button", "hse_button hse_button_primary",
      model.pricing_saving ? "Sauvegarde…" : "Sauvegarder (tarifs + capteurs)"
    );
    btnSave2.disabled = busy;
    btnSave2.addEventListener("click", () => {
      btnSave2.disabled = true;
      btnSave2.textContent = "Sauvegarde…";
      on_action("pricing_save");
    });
    costToolbar.appendChild(btnSave2);
    card.appendChild(costToolbar);
  }

  window.hse_config_view = { render_config, _current_reference_entity_id, _reference_status_from_catalogue };
})();
