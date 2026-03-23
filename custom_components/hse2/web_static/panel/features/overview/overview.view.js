(function () {
  const { el, clear } = window.hse_dom;

  function _ls_get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function _ls_set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  function _num(x) {
    const v = Number.parseFloat(String(x));
    return Number.isFinite(v) ? v : null;
  }

  function _fmt_w(w) {
    if (w == null) return '—';
    if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(2)} kW`;
    return `${Math.round(w)} W`;
  }

  function _fmt_kwh(x) {
    const v = _num(x);
    if (v == null) return '—';
    return `${v.toFixed(3)} kWh`;
  }

  function _fmt_eur(x) {
    const v = _num(x);
    if (v == null) return '—';
    return `${v.toFixed(2)} €`;
  }

  function _display_mode(pricing) {
    const mode = String(pricing?.display_mode || 'ttc').toLowerCase();
    return mode === 'ht' ? 'ht' : 'ttc';
  }

  function _view_mode(pricing) {
    // Priorité 1 : valeur dans hse_overview_state (store)
    const from_store = window.hse_overview_state?.get('tax_mode');
    if (from_store === 'ht' || from_store === 'ttc') return from_store;
    // Priorité 2 : localStorage legacy
    const saved = String(_ls_get('hse_overview_tax_mode') || '').toLowerCase();
    if (saved === 'ht' || saved === 'ttc') return saved;
    return _display_mode(pricing);
  }

  function _mk_kv(label, value, mono) {
    const row = el('div', 'hse_toolbar');
    row.appendChild(el('div', 'hse_subtitle', label));
    row.appendChild(el('div', mono ? 'hse_mono' : 'hse_kpi_value', value == null || value === '' ? '—' : String(value)));
    return row;
  }

  function _mk_table(rows, cols) {
    const table = document.createElement('table');
    table.className = 'hse_table';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    for (const c of cols) {
      const th = document.createElement('th');
      th.textContent = c.label;
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const c of cols) {
        const td = document.createElement('td');
        const v = c.value(r);
        if (v instanceof Node) td.appendChild(v);
        else td.textContent = v == null ? '' : String(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function _pill_title(text) {
    return el('div', 'hse_pill_title', text);
  }

  function _power_w_from_state(st) {
    if (!st) return null;
    const v = _num(st.state);
    if (v == null) return null;
    const unit = (st.attributes || {}).unit_of_measurement || '';
    if (unit === 'kW' || unit === 'kw') return v * 1000.0;
    return v;
  }

  function _refresh_live_from_hass(dash, hass) {
    if (!dash || !hass || !hass.states) return;
    const selected = Array.isArray(dash.selected) ? dash.selected : [];
    for (const r of selected) {
      const st = hass.states[r.entity_id];
      if (!st) continue;
      r.power_w = _power_w_from_state(st);
      r.state = st.state;
      r.unit = (st.attributes || {}).unit_of_measurement;
      r.last_updated = st.last_updated || st.last_changed || null;
      r.name = (st.attributes || {}).friendly_name || r.name || r.entity_id;
    }
    const top_src = selected.filter((r) => typeof r.power_w === 'number' && Number.isFinite(r.power_w));
    top_src.sort((a, b) => Number(b.power_w) - Number(a.power_w));
    dash.top_live = {
      bucket_100_500: top_src.filter((r) => 100.0 <= Number(r.power_w) && Number(r.power_w) <= 500.0).slice(0, 8),
      bucket_gt_500:  top_src.filter((r) => Number(r.power_w) > 500.0).slice(0, 8),
    };
    const total_w = selected.reduce((acc, r) => acc + (typeof r.power_w === 'number' ? Number(r.power_w) : 0.0), 0.0);
    dash.computed = dash.computed || {};
    dash.computed.total_power_w = total_w;
    if (dash.reference && dash.reference.entity_id) {
      const ref_st = hass.states[dash.reference.entity_id];
      if (ref_st) {
        dash.reference.power_w = _power_w_from_state(ref_st);
        dash.reference.state = ref_st.state;
        dash.reference.unit = (ref_st.attributes || {}).unit_of_measurement;
        dash.reference.last_updated = ref_st.last_updated || ref_st.last_changed || null;
        dash.reference.name = (ref_st.attributes || {}).friendly_name || dash.reference.name || dash.reference.entity_id;
      }
      if (typeof dash.reference.power_w === 'number' && Number.isFinite(dash.reference.power_w)) {
        dash.delta = dash.delta || {};
        dash.delta.power_w = Number(dash.reference.power_w) - Number(total_w);
      }
    }
  }

  function _row_cost(row, mode)         { return mode === 'ht' ? row?.cost_ht        : row?.cost_ttc; }
  function _row_subscription(row, mode) { return mode === 'ht' ? row?.subscription_ht : row?.subscription_ttc; }
  function _row_total(row, mode)        { return mode === 'ht' ? row?.total_ht        : row?.total_ttc; }

  function _mk_mode_switch(active_mode, onChange) {
    const wrap = el('div', 'hse_card_actions');
    const btnHt  = el('button', 'hse_button', 'Vue HT');
    const btnTtc = el('button', 'hse_button', 'Vue TTC');
    btnHt.disabled  = active_mode === 'ht';
    btnTtc.disabled = active_mode === 'ttc';
    btnHt.addEventListener('click',  () => onChange('ht'));
    btnTtc.addEventListener('click', () => onChange('ttc'));
    wrap.appendChild(btnHt);
    wrap.appendChild(btnTtc);
    return wrap;
  }

  function _render_totals_card(container, title, totals, mode) {
    const card = el('div', 'hse_kpi_card');
    card.appendChild(el('div', 'hse_kpi_title', title));
    card.appendChild(el('div', 'hse_subtitle', `Vue ${mode.toUpperCase()}`));
    card.appendChild(_mk_kv('Énergie', _fmt_kwh(totals?.energy_kwh), false));
    card.appendChild(_mk_kv('Coût consommation', _fmt_eur(mode === 'ht' ? totals?.conso_ht : totals?.conso_ttc), false));
    card.appendChild(_mk_kv('Coût abonnement',   _fmt_eur(mode === 'ht' ? totals?.subscription_ht : totals?.subscription_ttc), false));
    const total = el('div', 'hse_kpi_total');
    total.appendChild(el('div', 'hse_subtitle', 'Total'));
    total.appendChild(el('div', 'hse_kpi_total_value', _fmt_eur(mode === 'ht' ? totals?.total_ht : totals?.total_ttc)));
    card.appendChild(total);
    container.appendChild(card);
  }

  function _render_live_top(container, dash) {
    const card = el('div', 'hse_card');
    card.appendChild(_pill_title('Top consommateurs (live)'));
    card.appendChild(el('div', 'hse_subtitle', 'Capteurs inclus dans Summary, triés par puissance instantanée.'));
    const grid = el('div', 'hse_grid_2col hse_grid_tight');
    const mk_box = (title, rows) => {
      const box = el('div', 'hse_list_box');
      box.appendChild(el('div', 'hse_list_title', title));
      if (!rows.length) { box.appendChild(el('div', 'hse_subtitle', '—')); return box; }
      for (const r of rows) {
        const row  = el('div', 'hse_list_row');
        const left = el('div', 'hse_list_left');
        left.appendChild(el('div', null, r.name || r.entity_id));
        if (r.integration) left.appendChild(el('div', 'hse_subtitle', r.integration));
        row.appendChild(left);
        row.appendChild(el('div', 'hse_list_right', _fmt_w(r.power_w)));
        box.appendChild(row);
      }
      return box;
    };
    const b1 = Array.isArray(dash?.top_live?.bucket_100_500) ? dash.top_live.bucket_100_500 : [];
    const b2 = Array.isArray(dash?.top_live?.bucket_gt_500)  ? dash.top_live.bucket_gt_500  : [];
    grid.appendChild(mk_box('Appareils (100–500 W)', b1));
    grid.appendChild(mk_box('Appareils (> 500 W)',   b2));
    card.appendChild(grid);
    container.appendChild(card);
  }

  function _render_table_periods(container, title, rows, mode, footerText) {
    const card = el('div', 'hse_card');
    card.appendChild(_pill_title(title));
    card.appendChild(el('div', 'hse_subtitle', `Vue ${mode.toUpperCase()} · consommation, abonnement et total.`));
    if (!rows.length) { card.appendChild(el('div', 'hse_subtitle', '—')); container.appendChild(card); return; }
    card.appendChild(_mk_table(rows, [
      { label: 'Période',                value: (r) => r.period },
      { label: 'kWh',                    value: (r) => r.kwh == null ? '—' : String(_num(r.kwh)?.toFixed(3) ?? '—') },
      { label: 'Coût consommation (€)',  value: (r) => _fmt_eur(_row_cost(r, mode)) },
      { label: 'Coût abonnement (€)',    value: (r) => _fmt_eur(_row_subscription(r, mode)) },
      { label: 'Total (€)',              value: (r) => _fmt_eur(_row_total(r, mode)) },
    ]));
    if (footerText) card.appendChild(el('div', 'hse_subtitle', footerText));
    container.appendChild(card);
  }

  function _render_costs_per_sensor(container, dash, mode) {
    const card   = el('div', 'hse_card');
    const state  = {
      q:    '',
      open: (window.hse_overview_state?.get('costs_open')) ??
            ((_ls_get('hse_overview_costs_open') || '0') === '1'),
    };
    const header  = el('div', 'hse_card_header');
    header.appendChild(_pill_title('Coûts par capteur'));
    const actions   = el('div', 'hse_card_actions');
    const btnToggle = el('button', 'hse_button', state.open ? 'Replier' : 'Déplier');
    actions.appendChild(btnToggle);
    header.appendChild(actions);
    card.appendChild(header);
    const all      = Array.isArray(dash?.per_sensor_costs) ? dash.per_sensor_costs : [];
    const subtitle = el('div', 'hse_subtitle', `${all.length} capteurs · Triés par coût journalier décroissant · vue ${mode.toUpperCase()}`);
    card.appendChild(subtitle);
    const input = document.createElement('input');
    input.className   = 'hse_input';
    input.placeholder = 'Rechercher un capteur…';
    input.addEventListener('input', () => { state.q = String(input.value || ''); render(); });
    card.appendChild(input);
    const host = el('div');
    card.appendChild(host);
    const render = () => {
      clear(host);
      btnToggle.textContent = state.open ? 'Replier' : 'Déplier';
      if (!state.open) { host.appendChild(el('div', 'hse_subtitle', 'Déplie pour voir le tableau (zone scrollée).')); return; }
      const q        = state.q.trim().toLowerCase();
      const filtered = q ? all.filter((r) => String(r.name || r.entity_id || '').toLowerCase().includes(q)) : all.slice();
      const getCost  = (r, period) => { const m = mode === 'ht' ? r.cost_ht : r.cost_ttc; return m && typeof m === 'object' ? m[period] : null; };
      filtered.sort((a, b) => (_num(getCost(b, 'day')) || -1e9) - (_num(getCost(a, 'day')) || -1e9));
      if (!filtered.length) { host.appendChild(el('div', 'hse_subtitle', 'Aucun résultat.')); return; }
      const scroll = el('div', 'hse_scroll_area');
      scroll.appendChild(_mk_table(filtered, [
        { label: 'Capteur',      value: (r) => { const w = el('div'); w.appendChild(el('div', null, r.name || r.entity_id)); const s = el('div', 'hse_subtitle'); s.appendChild(el('span', 'hse_mono', r.entity_id || '')); w.appendChild(s); return w; } },
        { label: 'Jour (€)',     value: (r) => _fmt_eur(getCost(r, 'day'))   },
        { label: 'Semaine (€)',  value: (r) => _fmt_eur(getCost(r, 'week'))  },
        { label: 'Mois (€)',     value: (r) => _fmt_eur(getCost(r, 'month')) },
        { label: 'Année (€)',    value: (r) => _fmt_eur(getCost(r, 'year'))  },
      ]));
      host.appendChild(scroll);
    };
    btnToggle.addEventListener('click', () => {
      state.open = !state.open;
      if (window.hse_overview_state) window.hse_overview_state.set('costs_open', state.open);
      else _ls_set('hse_overview_costs_open', state.open ? '1' : '0');
      render();
    });
    render();
    container.appendChild(card);
  }

  // ── render_overview : construction initiale complète ──────────────────────
  // Appelé UNE SEULE FOIS (premier render ou changement d'onglet).
  // Ensuite c'est patch_live() qui met à jour en-place.
  function render_overview(container, data, hass) {
    clear(container);

    const dash = data?.dashboard || null;
    if (!dash || dash.ok !== true) {
      const card = el('div', 'hse_card');
      card.appendChild(_pill_title('Accueil'));
      card.appendChild(el('div', 'hse_subtitle', 'Impossible de charger le dashboard.'));
      container.appendChild(card);
      return;
    }

    _refresh_live_from_hass(dash, hass);

    const pricing      = dash.pricing || dash.defaults || {};
    const default_mode = _display_mode(pricing);
    const active_mode  = _view_mode(pricing);

    const rerenderWithMode = (mode) => {
      if (window.hse_overview_state) window.hse_overview_state.set('tax_mode', mode);
      else _ls_set('hse_overview_tax_mode', mode);
      render_overview(container, data, hass);
    };

    // ── Résumé général ──
    const cardSummary   = el('div', 'hse_card');
    cardSummary.dataset.hseOverviewSection = 'summary';
    const summaryHeader = el('div', 'hse_card_header');
    summaryHeader.appendChild(_pill_title('Résumé général'));
    summaryHeader.appendChild(_mk_mode_switch(active_mode, rerenderWithMode));
    cardSummary.appendChild(summaryHeader);
    cardSummary.appendChild(el('div', 'hse_subtitle', `Vue des coûts: ${active_mode.toUpperCase()} · mode par défaut configuré: ${default_mode.toUpperCase()}.`));
    const grid = el('div', 'hse_grid_2col');

    const cardSensors = el('div', 'hse_card hse_card_compact');
    cardSensors.dataset.hseOverviewSection = 'sensors_kpi';
    cardSensors.appendChild(el('div', 'hse_kpi_title', 'Capteurs'));
    cardSensors.appendChild(_mk_kv('Capteurs sélectionnés', `${Array.isArray(dash.selected) ? dash.selected.length : 0}`, false));
    const kv_total_power = _mk_kv('Capteurs sélectionnés (tous actifs)', _fmt_w(dash?.computed?.total_power_w), false);
    kv_total_power.dataset.hseOverviewLive = 'total_power_w';
    cardSensors.appendChild(kv_total_power);
    if (dash.reference?.entity_id) {
      const ref_name = dash.reference.name || dash.reference.entity_id;
      cardSensors.appendChild(_mk_kv('Capteur externe de référence', ref_name, false));
      const kv_ref_power = _mk_kv('Consommation référence (live)', _fmt_w(dash?.reference?.power_w), false);
      kv_ref_power.dataset.hseOverviewLive = 'reference_power_w';
      cardSensors.appendChild(kv_ref_power);
      const kv_delta = _mk_kv('Conso actuelle non mesurée (Delta)', _fmt_w(dash?.delta?.power_w), false);
      kv_delta.dataset.hseOverviewLive = 'delta_power_w';
      cardSensors.appendChild(kv_delta);
    }

    const cardContract = el('div', 'hse_card hse_card_compact');
    cardContract.appendChild(el('div', 'hse_kpi_title', 'Résumé contrat'));
    const ct = pricing.contract_type || 'fixed';
    cardContract.appendChild(_mk_kv('Type contrat', ct === 'hphc' ? 'HP / HC' : 'Fixe', false));
    cardContract.appendChild(_mk_kv('Vue active', active_mode.toUpperCase(), false));
    const sub = pricing.subscription_monthly || {};
    if (sub && (sub.ht != null || sub.ttc != null)) {
      cardContract.appendChild(_mk_kv('Abonnement mensuel HT',  _fmt_eur(sub.ht),  false));
      cardContract.appendChild(_mk_kv('Abonnement mensuel TTC', _fmt_eur(sub.ttc), false));
    }
    const fixed = pricing.fixed_energy_per_kwh || {};
    if (ct === 'fixed') {
      cardContract.appendChild(_mk_kv('Prix du kWh HT',  fixed.ht  != null ? `${String(fixed.ht)} €`  : '—', false));
      cardContract.appendChild(_mk_kv('Prix du kWh TTC', fixed.ttc != null ? `${String(fixed.ttc)} €` : '—', false));
    }
    const kv_fetched = _mk_kv('Dernier refresh', data?.fetched_at || '—', true);
    kv_fetched.dataset.hseOverviewLive = 'fetched_at';
    cardContract.appendChild(kv_fetched);

    grid.appendChild(cardSensors);
    grid.appendChild(cardContract);
    cardSummary.appendChild(grid);
    container.appendChild(cardSummary);

    _render_live_top(container, dash);

    const cardTotals = el('div', 'hse_card');
    cardTotals.appendChild(_pill_title('Coûts globaux'));
    cardTotals.appendChild(el('div', 'hse_subtitle', `Consommation + abonnement (tous capteurs sélectionnés), vue ${active_mode.toUpperCase()}.`));
    const totals_grid = el('div', 'hse_kpi_grid');
    const totals = dash.totals || {};
    _render_totals_card(totals_grid, 'Semaine', totals.week,  active_mode);
    _render_totals_card(totals_grid, 'Mois',    totals.month, active_mode);
    _render_totals_card(totals_grid, 'Année',   totals.year,  active_mode);
    cardTotals.appendChild(totals_grid);
    container.appendChild(cardTotals);

    const cum = Array.isArray(dash.cumulative_table) ? dash.cumulative_table : [];
    _render_table_periods(container, 'Consommation cumulée estimée (interne)', cum, active_mode);

    if (Array.isArray(dash.reference_table) && dash.reference_table.length)
      _render_table_periods(container, 'Capteur externe de référence', dash.reference_table, active_mode);

    if (Array.isArray(dash.delta_table) && dash.delta_table.length)
      _render_table_periods(container, 'Delta (externe - interne)', dash.delta_table, active_mode,
        'Le coût abonnement du delta reste généralement nul quand la même base d\'abonnement est utilisée des deux côtés.');

    _render_costs_per_sensor(container, dash, active_mode);

    // Section warnings — marquée pour patch_live
    if (Array.isArray(dash.warnings) && dash.warnings.length) {
      const card = el('div', 'hse_card');
      card.dataset.hseOverviewSection = 'warnings';
      card.appendChild(_pill_title('Warnings'));
      card.appendChild(el('pre', 'hse_code', dash.warnings.join('\n')));
      container.appendChild(card);
    }

    if (!hass) {
      const card = el('div', 'hse_card');
      card.appendChild(_pill_title('Debug'));
      card.appendChild(el('div', 'hse_subtitle', 'hass non disponible: valeurs temps réel indisponibles.'));
      container.appendChild(card);
    }

    // Marque le container comme "built" pour que patch_live puisse l'identifier
    container.dataset.hseOverviewBuilt = '1';
  }

  // ── patch_live : mise à jour en-place SANS clear() ────────────────────────
  // Appelé par le subscriber overview.state.js à chaque nouveau fetch.
  // Ne touche qu'aux valeurs numériques live et aux warnings.
  // Le scroll de l'utilisateur n'est JAMAIS interrompu.
  function patch_live(container, data, hass) {
    // Si le DOM n'est pas encore construit → construction complète
    if (!container || !container.dataset.hseOverviewBuilt) {
      render_overview(container, data, hass);
      return;
    }

    const dash = data?.dashboard || null;
    if (!dash || dash.ok !== true) return;

    _refresh_live_from_hass(dash, hass);

    // Mise à jour valeurs live balisées data-hse-overview-live
    const _patch_kv_value = (live_key, formatted_value) => {
      const node = container.querySelector(`[data-hse-overview-live="${live_key}"]`);
      if (!node) return;
      const val_el = node.querySelector('.hse_kpi_value, .hse_mono');
      if (val_el) val_el.textContent = formatted_value;
    };

    _patch_kv_value('total_power_w',    _fmt_w(dash?.computed?.total_power_w));
    _patch_kv_value('reference_power_w',_fmt_w(dash?.reference?.power_w));
    _patch_kv_value('delta_power_w',    _fmt_w(dash?.delta?.power_w));
    _patch_kv_value('fetched_at',       data?.fetched_at || '—');

    // Mise à jour Top consommateurs live (bucket cards)
    // On les recrée car c'est une liste triée dynamique — section stable, pas scrollée
    const live_top_card = container.querySelector('[data-hse-overview-section="live_top"]');
    // (section non balisée dans la version initiale — on tolère l'absence)

    // Mise à jour warnings : patch textContent du <pre> SANS recréer la card
    const warnings_card = container.querySelector('[data-hse-overview-section="warnings"]');
    if (Array.isArray(dash.warnings) && dash.warnings.length) {
      if (warnings_card) {
        const pre = warnings_card.querySelector('pre');
        if (pre) pre.textContent = dash.warnings.join('\n');
      } else {
        // Première apparition des warnings après un patch — on insère avant la fin
        const card = el('div', 'hse_card');
        card.dataset.hseOverviewSection = 'warnings';
        card.appendChild(_pill_title('Warnings'));
        card.appendChild(el('pre', 'hse_code', dash.warnings.join('\n')));
        container.appendChild(card);
      }
    } else if (warnings_card) {
      warnings_card.remove();
    }
  }

  window.hse_overview_view = { render_overview, patch_live };
})();
