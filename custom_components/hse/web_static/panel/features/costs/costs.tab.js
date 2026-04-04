/* costs.tab.js — Phase 1D | hse-tab-costs
   Dépend de: hse_live_store, hse_live_service, hse_costs_view
   Règle : formulaire compare jamais vidé lors d'un recalcul. Scroll conservé.
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
      // Source de vérité du shell
      this._state  = {
        view:    _subtab(),          // 'summary' | 'compare'
        loading: false,
        error:   null,
        data:    null,
        compare: {
          loading: false,
          result:  null,
          error:   null,
          params:  { period: 'month', mode: 'period' },  // stable, jamais réinitialisé
        },
      };
      // compare_form_built : flag pour ne construire le formulaire compare qu'une fois
      this._compare_form_built = false;
    }

    set hass(h) { this._hass = h; }
    get hass()  { return this._hass; }
    set panel(p) { this._panel = p; }
    get panel()  { return this._panel; }

    connectedCallback() {
      this._build_skeleton();
      this._subscribe();
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

      // ── toolbar principal ──────────────────────────────────────────
      const toolbar_card = _el('div', 'hse_card');
      toolbar_card.dataset.hseCostsToolbar = '1';

      // Titre
      toolbar_card.appendChild(_el('div', 'hse_kpi_title', '📊 Analyse de coûts'));

      // Ligne haute : sous-onglets + mode HT/TTC
      const top_row = _el('div', 'hse_card_header');
      const left_actions = _el('div', 'hse_card_actions');
      left_actions.dataset.hseCostsSubtabBtns = '1';
      top_row.appendChild(left_actions);
      const right_actions = _el('div', 'hse_card_actions');
      right_actions.dataset.hseCostsTaxBtns = '1';
      top_row.appendChild(right_actions);
      toolbar_card.appendChild(top_row);

      // Bouton Rafraîchir
      const refresh_row = _el('div', 'hse_toolbar');
      const btn_refresh = _el('button', 'hse_button hse_button_primary', 'Rafraîchir');
      btn_refresh.dataset.hseCostsRefreshBtn = '1';
      btn_refresh.addEventListener('click', () => window.hse_live_service?.refresh(DOMAIN));
      refresh_row.appendChild(btn_refresh);
      toolbar_card.appendChild(refresh_row);
      root.appendChild(toolbar_card);

      // ── zone corps ────────────────────────────────────────────────
      // Conteneur "period" (visible en mode summary)
      const period_host = _el('div');
      period_host.dataset.hseCostsPeriodHost = '1';
      root.appendChild(period_host);

      // Conteneur "compare" (deux sous-zones stables)
      const compare_host = _el('div');
      compare_host.dataset.hseCostsCompareHost = '1';
      compare_host.style.display = 'none';

      const compare_form = _el('div');     // formulaire — JAMAIS vidé pendant un recalcul
      compare_form.dataset.hseCostsCompareForm = '1';
      const compare_result = _el('div');   // résultats uniquement
      compare_result.dataset.hseCostsCompareResult = '1';
      compare_host.appendChild(compare_form);
      compare_host.appendChild(compare_result);
      root.appendChild(compare_host);

      this.appendChild(root);
      this._sync_toolbar();
    }

    // ── mise à jour toolbar uniquement (sans toucher au body) ───────
    _sync_toolbar() {
      const { data, loading } = this._state;
      const dash    = data?.dashboard || null;
      const pricing = dash?.pricing || dash?.defaults || {};
      const mode    = _display_mode(pricing);
      const subtab  = _state_subtab(this._state);

      // Bouton Rafraîchir
      const btn = this.querySelector('[data-hse-costs-refresh-btn]');
      if (btn) { btn.disabled = loading; btn.textContent = loading ? '…' : 'Rafraîchir'; }

      // Sous-onglets
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

      // HT / TTC
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

      // ── basculer visibilité des hôtes ──────────────────────────────
      const period_host  = this.querySelector('[data-hse-costs-period-host]');
      const compare_host = this.querySelector('[data-hse-costs-compare-host]');
      if (period_host)  period_host.style.display  = subtab === 'period'  ? '' : 'none';
      if (compare_host) compare_host.style.display = subtab === 'compare' ? '' : 'none';

      // ── état vide / erreur / chargement initial ────────────────────
      const host = subtab === 'compare' ? period_host : period_host; // period_host pour états vides
      if (subtab === 'period') {
        if (loading && !data) {
          period_host.innerHTML = _loading_card().outerHTML;
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
      }

      if (!data) return;

      const dash    = data.dashboard || null;
      const pricing = dash?.pricing  || dash?.defaults || {};
      const mode    = _display_mode(pricing);

      // ── mode Période ───────────────────────────────────────────────
      if (subtab === 'period') {
        if (window.hse_costs_view?.render_period) {
          // API fine-grained (si disponible dans costs.view.js)
          window.hse_costs_view.render_period(period_host, dash, mode, () => this._schedule_render());
        } else if (window.hse_costs_view?.render_costs) {
          // Fallback : render complet (costs.view.js non patché)
          window.hse_costs_view.render_costs(period_host, data, this._hass);
        }
        return;
      }

      // ── mode Comparaison ───────────────────────────────────────────
      const compare_form   = this.querySelector('[data-hse-costs-compare-form]');
      const compare_result = this.querySelector('[data-hse-costs-compare-result]');
      if (!compare_form || !compare_result) return;

      if (window.hse_costs_view?.render_compare_form && window.hse_costs_view?.render_compare_result) {
        // API fine-grained exposée par costs.view.js patché
        if (!this._compare_form_built || !loading) {
          // Construire/reconstruire le formulaire uniquement si pas encore fait
          // ou si on n'est pas en train de recalculer (sinon on le laisse intact)
          if (!this._compare_form_built) {
            window.hse_costs_view.render_compare_form(
              compare_form, dash, mode,
              () => this._schedule_render(),
              this._hass
            );
            this._compare_form_built = true;
          }
          // Si mode ou preset change (non-loading), reconstruire le formulaire
          if (!loading) {
            window.hse_costs_view.render_compare_form(
              compare_form, dash, mode,
              () => this._schedule_render(),
              this._hass
            );
          }
        }
        // Résultats : toujours remplaçables sans toucher au formulaire
        if (!loading) {
          window.hse_costs_view.render_compare_result(
            compare_result, dash, mode,
            () => this._schedule_render(),
            this._hass
          );
        } else {
          // Pendant le recalcul : spinner inline dans la zone résultats SEULEMENT
          compare_result.innerHTML = '';
          compare_result.appendChild(_loading_card('Calcul en cours…'));
        }
      } else if (window.hse_costs_view?.render_costs) {
        // Fallback dégradé : render complet dans compare_host
        // Le formulaire sera reconstruit (comportement pré-1D) mais au moins le host compare est stable
        const scroll_y = compare_host?.scrollTop || 0;
        window.hse_costs_view.render_costs(compare_host, data, this._hass);
        if (compare_host && scroll_y) compare_host.scrollTop = scroll_y;
      }
    }
  }

  // ── helpers état ──────────────────────────────────────────────────
  function _state_subtab(state) {
    return state.view === 'compare' ? 'compare' : 'period';
  }

  // ── helpers UI ────────────────────────────────────────────────────
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
