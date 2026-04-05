/* costs.tab.js — Phase 1D | hse-tab-costs
   Dépend de: hse_live_store, hse_live_service, hse_costs_view
   Règle : formulaire compare jamais vidé lors d'un recalcul standard. Scroll conservé.
*/
(function () {
  if (customElements.get('hse-tab-costs')) return;
  const DOMAIN = 'costs';

  // ── helpers localStorage ──────────────────────────────────────────
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

  // ── micro el helper ───────────────────────────────────────────────
  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)  e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _mk_toggle_btn(label, active, onClick) {
    const b = _el('button', 'hse_button', label);
    b.disabled = !!active;
    b.addEventListener('click', onClick);
    return b;
  }

  // ── composant ─────────────────────────────────────────────────────
  class HseTabCosts extends HTMLElement {
    constructor() {
      super();
      this._hass   = null;
      this._panel  = null;
      this._unsubs = [];
      this._raf    = false;
      this._state  = {
        view:    _subtab(),
        loading: false,
        error:   null,
        data:    null,
        compare: {
          loading: false,
          result:  null,
          error:   null,
          params:  { period: 'month', mode: 'period' },
        },
      };
      this._compare_form_key = null;
    }

    set hass(h) { this._hass = h; }
    get hass()  { return this._hass; }
    set panel(p) { this._panel = p; }
    get panel()  { return this._panel; }

    connectedCallback() {
      // Différer les mutations DOM pour éviter le appendChild imbriqué :
      // customElements.define() upgrade l'élément pendant son insertion dans le DOM
      // (appendChild dans _ensure_tab_mounted). Si _build_skeleton() appelle
      // this.appendChild(root) de manière synchrone ici, le browser lève :
      //   NotSupportedError: The result must not have children
      // Promise.resolve() garantit que l'insertion parente est terminée avant
      // que nous mutations l'arbre DOM depuis cet élément.
      Promise.resolve().then(() => {
        if (!this.isConnected) return; // guard : élément retiré entre-temps
        this._build_skeleton();
        this._subscribe();
      });
    }

    disconnectedCallback() { this._unsubscribe(); }

    _subscribe() {
      this._unsubscribe();
      const s = window.hse_live_store;
      if (!s) return;
      this._unsubs.push(
        s.subscribe(DOMAIN, 'data',    (v) => { this._state.data    = v;   this._schedule_render(); }),
        s.subscribe(DOMAIN, 'loading', (v) => { this._state.loading = !!v; this._schedule_render(); }),
        s.subscribe(DOMAIN, 'error',   (v) => { this._state.error   = v;   this._schedule_render(); }),
      );
    }

    _unsubscribe() {
      for (const u of this._unsubs) try { u(); } catch (_) {}
      this._unsubs = [];
    }

    // ── skeleton stable (construit une seule fois) ─────────────────
    _build_skeleton() {
      if (this.querySelector('[data-hse-costs-root]')) return;

      const root = _el('div');
      root.dataset.hseCostsRoot = '1';

      // toolbar principal
      const toolbar_card = _el('div', 'hse_card');
      toolbar_card.dataset.hseCostsToolbar = '1';
      toolbar_card.appendChild(_el('div', 'hse_kpi_title', '📊 Analyse de coûts'));

      const top_row = _el('div', 'hse_card_header');
      const left_actions = _el('div', 'hse_card_actions');
      left_actions.dataset.hseCostsSubtabBtns = '1';
      top_row.appendChild(left_actions);
      const right_actions = _el('div', 'hse_card_actions');
      right_actions.dataset.hseCostsTaxBtns = '1';
      top_row.appendChild(right_actions);
      toolbar_card.appendChild(top_row);

      const refresh_row = _el('div', 'hse_toolbar');
      const btn_refresh = _el('button', 'hse_button hse_button_primary', 'Rafraîchir');
      btn_refresh.dataset.hseCostsRefreshBtn = '1';
      btn_refresh.addEventListener('click', () => window.hse_live_service?.refresh(DOMAIN));
      refresh_row.appendChild(btn_refresh);
      toolbar_card.appendChild(refresh_row);
      root.appendChild(toolbar_card);

      // zone période
      const period_host = _el('div');
      period_host.dataset.hseCostsPeriodHost = '1';
      root.appendChild(period_host);

      // zone compare : formulaire + résultats séparés
      const compare_host = _el('div');
      compare_host.dataset.hseCostsCompareHost = '1';
      compare_host.style.display = 'none';
      const compare_form = _el('div');    // JAMAIS vidé pendant un recalcul standard
      compare_form.dataset.hseCostsCompareForm = '1';
      const compare_result = _el('div'); // remplaçable librement
      compare_result.dataset.hseCostsCompareResult = '1';
      compare_host.appendChild(compare_form);
      compare_host.appendChild(compare_result);
      root.appendChild(compare_host);

      this.appendChild(root);
      this._sync_toolbar();
    }

    // ── toolbar (ne touche pas aux zones de contenu) ────────────────
    _sync_toolbar() {
      const { data, loading } = this._state;
      const dash    = data?.dashboard || null;
      const pricing = dash?.pricing || dash?.defaults || {};
      const mode    = _display_mode(pricing);
      const subtab  = _state_subtab(this._state);

      const btn = this.querySelector('[data-hse-costs-refresh-btn]');
      if (btn) { btn.disabled = loading; btn.textContent = loading ? '…' : 'Rafraîchir'; }

      const st_zone = this.querySelector('[data-hse-costs-subtab-btns]');
      if (st_zone) {
        st_zone.innerHTML = '';
        st_zone.appendChild(_mk_toggle_btn('Période', subtab === 'period', () => {
          _set_subtab('period');
          this._state.view = 'period';
          this._schedule_render();
        }));
        st_zone.appendChild(_mk_toggle_btn('Comparaison', subtab === 'compare', () => {
          _set_subtab('compare');
          this._state.view = 'compare';
          this._schedule_render();
        }));
      }

      const tax_zone = this.querySelector('[data-hse-costs-tax-btns]');
      if (tax_zone) {
        tax_zone.innerHTML = '';
        tax_zone.appendChild(_mk_toggle_btn('Vue HT',  mode === 'ht',  () => { _set_display_mode('ht');  this._schedule_render(); }));
        tax_zone.appendChild(_mk_toggle_btn('Vue TTC', mode === 'ttc', () => { _set_display_mode('ttc'); this._schedule_render(); }));
      }
    }

    _schedule_render() {
      if (this._raf) return;
      this._raf = true;
      window.requestAnimationFrame(() => { this._raf = false; this._render(); });
    }

    _render() {
      if (!this.isConnected) return;
      const { data, loading, error } = this._state;
      const subtab = _state_subtab(this._state);

      this._sync_toolbar();

      // ── visibilité des hôtes ──────────────────────────────────────
      const period_host  = this.querySelector('[data-hse-costs-period-host]');
      const compare_host = this.querySelector('[data-hse-costs-compare-host]');
      if (period_host)  period_host.style.display  = subtab === 'period'  ? '' : 'none';
      if (compare_host) compare_host.style.display = subtab === 'compare' ? '' : 'none';

      // ── mode Période ───────────────────────────────────────────────
      if (subtab === 'period') {
        if (loading && !data) {
          period_host.innerHTML = '';
          period_host.appendChild(_loading_card());
          return;
        }
        if (error && !data) {
          period_host.innerHTML = '';
          period_host.appendChild(_error_card(error));
          return;
        }
        if (!data) {
          period_host.innerHTML = '';
          period_host.appendChild(_empty_card());
          return;
        }

        const dash    = data.dashboard || null;
        const pricing = dash?.pricing  || dash?.defaults || {};
        const mode    = _display_mode(pricing);

        if (window.hse_costs_view?.render_period) {
          window.hse_costs_view.render_period(period_host, dash, mode, () => this._schedule_render());
        } else if (window.hse_costs_view?.render_costs) {
          window.hse_costs_view.render_costs(period_host, data, this._hass);
        }
        return;
      }

      // ── mode Comparaison ───────────────────────────────────────────
      if (!data) return;

      const dash    = data.dashboard || null;
      const pricing = dash?.pricing  || dash?.defaults || {};
      const mode    = _display_mode(pricing);

      const compare_form   = this.querySelector('[data-hse-costs-compare-form]');
      const compare_result = this.querySelector('[data-hse-costs-compare-result]');
      if (!compare_form || !compare_result) return;

      if (window.hse_costs_view?.render_compare_form && window.hse_costs_view?.render_compare_result) {
        const form_key = `${_compare_preset()}|${mode}`;
        const needs_form_rebuild = (form_key !== this._compare_form_key);

        if (needs_form_rebuild && !loading) {
          window.hse_costs_view.render_compare_form(
            compare_form, dash, mode,
            () => this._schedule_render(),
            this._hass
          );
          this._compare_form_key = form_key;
        }

        if (loading) {
          compare_result.innerHTML = '';
          compare_result.appendChild(_loading_card('Calcul en cours…'));
        } else {
          window.hse_costs_view.render_compare_result(
            compare_result, dash, mode,
            () => this._schedule_render(),
            this._hass
          );
        }
      } else if (window.hse_costs_view?.render_costs) {
        const host = this.querySelector('[data-hse-costs-compare-host]');
        const scroll_y = host?.scrollTop || 0;
        window.hse_costs_view.render_costs(host, data, this._hass);
        if (host && scroll_y) host.scrollTop = scroll_y;
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────────────
  function _state_subtab(state) {
    return state.view === 'compare' ? 'compare' : 'period';
  }

  function _loading_card(msg) {
    const c = document.createElement('div'); c.className = 'hse_card';
    const s = document.createElement('div'); s.className = 'hse_subtitle';
    s.textContent = msg || 'Chargement des coûts…';
    c.appendChild(s); return c;
  }
  function _error_card(err) {
    const c = document.createElement('div'); c.className = 'hse_card';
    const t = document.createElement('div'); t.className = 'hse_kpi_title'; t.textContent = 'Erreur'; c.appendChild(t);
    const p = document.createElement('pre'); p.className = 'hse_code'; p.textContent = String(err); c.appendChild(p);
    return c;
  }
  function _empty_card() {
    const c = document.createElement('div'); c.className = 'hse_card';
    const s = document.createElement('div'); s.className = 'hse_subtitle'; s.textContent = 'Aucune donnée disponible.'; c.appendChild(s);
    return c;
  }

  customElements.define('hse-tab-costs', HseTabCosts);
  console.info('[HSE] hse-tab-costs registered');
})();
