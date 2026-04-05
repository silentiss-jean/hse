/* costs.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.costs
   Dépend de : hse_live_store (via ctx), hse_live_service (via ctx), hse_costs_view
   Règle : formulaire compare jamais vidé lors d'un recalcul standard. Scroll conservé.

   Contrat ctx : { hass, panel, actions, live_store, live_service }
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.costs) return;

  const DOMAIN = 'costs';

  function _ls_get(k) { try { return window.localStorage.getItem(k); } catch (_) { return null; } }
  function _ls_set(k, v) { try { window.localStorage.setItem(k, v); } catch (_) {} }
  function _subtab() {
    const v = String(_ls_get('hse_costs_subtab') || 'period').toLowerCase();
    return v === 'compare' ? 'compare' : 'period';
  }
  function _set_subtab(v) { _ls_set('hse_costs_subtab', v === 'compare' ? 'compare' : 'period'); }
  function _display_mode(pricing) {
    const s = String(_ls_get('hse_costs_tax_mode') || '').toLowerCase();
    if (s === 'ht' || s === 'ttc') return s;
    return String(pricing?.display_mode || 'ttc').toLowerCase() === 'ht' ? 'ht' : 'ttc';
  }
  function _set_display_mode(m) { _ls_set('hse_costs_tax_mode', m === 'ht' ? 'ht' : 'ttc'); }
  function _compare_preset() {
    const v = String(_ls_get('hse_costs_compare_preset') || 'today_vs_yesterday').toLowerCase();
    return ['today_vs_yesterday','this_week_vs_last_week','this_weekend_vs_last_weekend','custom'].includes(v) ? v : 'today_vs_yesterday';
  }

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)        e.className   = cls;
    if (text!=null) e.textContent = text;
    return e;
  }
  function _mk_toggle_btn(label, active, onClick) {
    const b = _el('button', 'hse_button', label);
    b.disabled = !!active;
    b.addEventListener('click', onClick);
    return b;
  }

  let _state            = null;
  let _container        = null;
  let _hass             = null;
  let _live_service_ref = null;
  let _unsubs           = [];
  let _raf              = false;
  let _compare_form_key = null;

  function _init_state() {
    _state = {
      view:    _subtab(),
      loading: false,
      error:   null,
      data:    null,
      compare: { loading: false, result: null, error: null, params: { period: 'month', mode: 'period' } },
    };
  }

  function _unsubscribe() {
    for (const u of _unsubs) try { u(); } catch (_) {}
    _unsubs = [];
  }

  function _build_skeleton(container) {
    if (container.querySelector('[data-hse-costs-root]')) return;

    const root = _el('div');
    root.dataset.hseCostsRoot = '1';

    const toolbar_card = _el('div', 'hse_card');
    toolbar_card.dataset.hseCostsToolbar = '1';
    toolbar_card.appendChild(_el('div', 'hse_kpi_title', '\u{1F4CA} Analyse de co\u00fbts'));

    const top_row = _el('div', 'hse_card_header');
    const left_actions = _el('div', 'hse_card_actions');
    left_actions.dataset.hseCostsSubtabBtns = '1';
    top_row.appendChild(left_actions);
    const right_actions = _el('div', 'hse_card_actions');
    right_actions.dataset.hseCostsTaxBtns = '1';
    top_row.appendChild(right_actions);
    toolbar_card.appendChild(top_row);

    const refresh_row = _el('div', 'hse_toolbar');
    const btn_refresh = _el('button', 'hse_button hse_button_primary', 'Rafra\u00eechir');
    btn_refresh.dataset.hseCostsRefreshBtn = '1';
    btn_refresh.addEventListener('click', () => (_live_service_ref ?? window.hse_live_service)?.refresh?.(DOMAIN));
    refresh_row.appendChild(btn_refresh);
    toolbar_card.appendChild(refresh_row);
    root.appendChild(toolbar_card);

    const period_host = _el('div');
    period_host.dataset.hseCostsPeriodHost = '1';
    root.appendChild(period_host);

    const compare_host = _el('div');
    compare_host.dataset.hseCostsCompareHost = '1';
    compare_host.style.display = 'none';
    const compare_form   = _el('div');
    compare_form.dataset.hseCostsCompareForm = '1';
    const compare_result = _el('div');
    compare_result.dataset.hseCostsCompareResult = '1';
    compare_host.appendChild(compare_form);
    compare_host.appendChild(compare_result);
    root.appendChild(compare_host);

    container.appendChild(root);
    _sync_toolbar(container);
  }

  function _sync_toolbar(container) {
    const { data, loading } = _state;
    const dash    = data?.dashboard || null;
    const pricing = dash?.pricing || dash?.defaults || {};
    const mode    = _display_mode(pricing);
    const subtab  = _state.view === 'compare' ? 'compare' : 'period';

    const btn = container.querySelector('[data-hse-costs-refresh-btn]');
    if (btn) { btn.disabled = loading; btn.textContent = loading ? '\u2026' : 'Rafra\u00eechir'; }

    const st_zone = container.querySelector('[data-hse-costs-subtab-btns]');
    if (st_zone) {
      st_zone.innerHTML = '';
      st_zone.appendChild(_mk_toggle_btn('P\u00e9riode', subtab === 'period', () => {
        _set_subtab('period'); _state.view = 'period'; _schedule_render();
      }));
      st_zone.appendChild(_mk_toggle_btn('Comparaison', subtab === 'compare', () => {
        _set_subtab('compare'); _state.view = 'compare'; _schedule_render();
      }));
    }

    const tax_zone = container.querySelector('[data-hse-costs-tax-btns]');
    if (tax_zone) {
      tax_zone.innerHTML = '';
      tax_zone.appendChild(_mk_toggle_btn('Vue HT',  mode === 'ht',  () => { _set_display_mode('ht');  _schedule_render(); }));
      tax_zone.appendChild(_mk_toggle_btn('Vue TTC', mode === 'ttc', () => { _set_display_mode('ttc'); _schedule_render(); }));
    }
  }

  function _schedule_render() {
    if (_raf) return;
    _raf = true;
    window.requestAnimationFrame(() => { _raf = false; _render_full(); });
  }

  function _render_full() {
    if (!_container) return;
    const { data, loading, error } = _state;
    const subtab = _state.view === 'compare' ? 'compare' : 'period';

    _sync_toolbar(_container);

    const period_host  = _container.querySelector('[data-hse-costs-period-host]');
    const compare_host = _container.querySelector('[data-hse-costs-compare-host]');
    if (period_host)  period_host.style.display  = subtab === 'period'  ? '' : 'none';
    if (compare_host) compare_host.style.display = subtab === 'compare' ? '' : 'none';

    if (subtab === 'period') {
      if (!period_host) return;
      if (loading && !data) { period_host.innerHTML = ''; period_host.appendChild(_loading_card()); return; }
      if (error && !data)   { period_host.innerHTML = ''; period_host.appendChild(_error_card(error)); return; }
      if (!data)             { period_host.innerHTML = ''; period_host.appendChild(_empty_card()); return; }
      const dash    = data.dashboard || null;
      const pricing = dash?.pricing  || dash?.defaults || {};
      const mode    = _display_mode(pricing);
      if (window.hse_costs_view?.render_period) {
        window.hse_costs_view.render_period(period_host, dash, mode, () => _schedule_render());
      } else if (window.hse_costs_view?.render_costs) {
        window.hse_costs_view.render_costs(period_host, data, _hass);
      }
      return;
    }

    if (!data) return;
    const dash    = data.dashboard || null;
    const pricing = dash?.pricing  || dash?.defaults || {};
    const mode    = _display_mode(pricing);
    const compare_form   = _container.querySelector('[data-hse-costs-compare-form]');
    const compare_result = _container.querySelector('[data-hse-costs-compare-result]');
    if (!compare_form || !compare_result) return;

    if (window.hse_costs_view?.render_compare_form && window.hse_costs_view?.render_compare_result) {
      const form_key = `${_compare_preset()}|${mode}`;
      if (form_key !== _compare_form_key && !loading) {
        window.hse_costs_view.render_compare_form(compare_form, dash, mode, () => _schedule_render(), _hass);
        _compare_form_key = form_key;
      }
      if (loading) {
        compare_result.innerHTML = '';
        compare_result.appendChild(_loading_card('Calcul en cours\u2026'));
      } else {
        window.hse_costs_view.render_compare_result(compare_result, dash, mode, () => _schedule_render(), _hass);
      }
    } else if (window.hse_costs_view?.render_costs) {
      window.hse_costs_view.render_costs(compare_host, data, _hass);
    }
  }

  function _loading_card(msg) {
    const c = document.createElement('div'); c.className = 'hse_card';
    const s = document.createElement('div'); s.className = 'hse_subtitle';
    s.textContent = msg || 'Chargement des co\u00fbts\u2026'; c.appendChild(s); return c;
  }
  function _error_card(err) {
    const c = document.createElement('div'); c.className = 'hse_card';
    const t = document.createElement('div'); t.className = 'hse_kpi_title'; t.textContent = 'Erreur'; c.appendChild(t);
    const p = document.createElement('pre'); p.className = 'hse_code'; p.textContent = String(err); c.appendChild(p); return c;
  }
  function _empty_card() {
    const c = document.createElement('div'); c.className = 'hse_card';
    const s = document.createElement('div'); s.className = 'hse_subtitle'; s.textContent = 'Aucune donn\u00e9e disponible.'; c.appendChild(s); return c;
  }

  window.hse_tabs_registry.costs = {
    mount(container, ctx) {
      _container        = container;
      _hass             = ctx.hass;
      _live_service_ref = ctx.live_service ?? null;
      _compare_form_key = null;
      _init_state();
      _build_skeleton(container);
      _unsubscribe();
      const s = ctx.live_store ?? window.hse_live_store;
      if (s) {
        _unsubs.push(
          s.subscribe(DOMAIN, 'data',    (v) => { _state.data    = v;   _schedule_render(); }),
          s.subscribe(DOMAIN, 'loading', (v) => { _state.loading = !!v; _schedule_render(); }),
          s.subscribe(DOMAIN, 'error',   (v) => { _state.error   = v;   _schedule_render(); }),
        );
      }
    },

    update_hass(hass) { _hass = hass; },

    unmount() {
      _unsubscribe();
      _container        = null;
      _hass             = null;
      _live_service_ref = null;
      _state            = null;
    },
  };

  console.info('[HSE] tab module: costs registered');
})();
