/* costs.tab.js — Custom element hse-tab-costs
   Phase 1D — HSE Frontend Refonte
   Migré depuis costs.view.js — cycle de vie via hse_live_store
   Ne jamais vider le formulaire compare lors d'un recalcul.
   Dépend de: window.hse_live_store, window.hse_live_service, window.hse_costs_view
*/
(function () {
  if (customElements.get('hse-tab-costs')) {
    console.info('[HSE] hse-tab-costs already defined, skipping');
    return;
  }

  const DOMAIN = 'costs';

  class HseTabCosts extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._panel = null;
      this._unsubs = [];
      this._state = {
        view:    'summary',   // 'summary' | 'compare'
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
      this._raf_pending = false;
    }

    // ── Propriétés HA ───────────────────────────────────────────────────
    set hass(h) {
      this._hass = h;
      // Pas de re-render ici : le store gère les données
    }
    get hass() { return this._hass; }

    set panel(p) { this._panel = p; }
    get panel()  { return this._panel; }

    // ── Cycle de vie ─────────────────────────────────────────────────────
    connectedCallback() {
      this._subscribe();
      this._render();
    }

    disconnectedCallback() {
      this._unsubscribe();
    }

    _subscribe() {
      this._unsubscribe();
      const store = window.hse_live_store;
      if (!store) return;

      const _on_change = () => this._schedule_render();

      this._unsubs.push(
        store.subscribe(DOMAIN, 'data',    (v) => { this._state.data = v;    _on_change(); }),
        store.subscribe(DOMAIN, 'loading', (v) => { this._state.loading = !!v; _on_change(); }),
        store.subscribe(DOMAIN, 'error',   (v) => { this._state.error = v;   _on_change(); }),
      );
    }

    _unsubscribe() {
      for (const unsub of this._unsubs) {
        try { unsub(); } catch (_) {}
      }
      this._unsubs = [];
    }

    // ── Rendu ────────────────────────────────────────────────────────────
    _schedule_render() {
      if (this._raf_pending) return;
      this._raf_pending = true;
      window.requestAnimationFrame(() => {
        this._raf_pending = false;
        this._render();
      });
    }

    _render() {
      if (!this.isConnected) return;
      const { data, loading, error } = this._state;

      // Fallback: si live.service pas encore démarré, essayer de récupérer
      // via la source legacy (hse_live_store ou hse_overview_state)
      const resolved_data = data
        ?? window.hse_live_store?.get('overview', 'data')
        ?? window.hse_overview_state?.get('data');

      this.innerHTML = '';

      // État de chargement
      if (loading && !resolved_data) {
        const wrapper = _mk_el('div', 'hse_card');
        wrapper.appendChild(_mk_el('div', 'hse_subtitle', 'Chargement des coûts…'));
        this.appendChild(wrapper);
        return;
      }

      // État d'erreur
      if (error && !resolved_data) {
        const wrapper = _mk_el('div', 'hse_card');
        wrapper.appendChild(_mk_el('div', 'hse_kpi_title', 'Erreur'));
        wrapper.appendChild(_mk_el('pre', 'hse_code', String(error)));
        this.appendChild(wrapper);
        return;
      }

      // Bouton Rafraîchir — appelle live.service.refresh
      const toolbar_card = _mk_el('div', 'hse_card');
      const toolbar = _mk_el('div', 'hse_toolbar');
      const btn_refresh = _mk_el('button', 'hse_button hse_button_primary', 'Rafraîchir');
      if (loading) {
        btn_refresh.disabled = true;
        btn_refresh.textContent = '…';
      }
      btn_refresh.addEventListener('click', () => {
        window.hse_live_service?.refresh(DOMAIN);
      });
      toolbar.appendChild(btn_refresh);
      toolbar_card.appendChild(toolbar);
      this.appendChild(toolbar_card);

      // Pas de données encore
      if (!resolved_data) {
        const c = _mk_el('div', 'hse_card');
        c.appendChild(_mk_el('div', 'hse_subtitle', 'Aucune donnée disponible.'));
        this.appendChild(c);
        return;
      }

      // Déléguer le rendu à costs.view.js si disponible
      if (window.hse_costs_view?.render_costs) {
        // Conteneur dédié pour costs.view — NE PAS vider this directement
        // pour éviter le scroll-jack. On réutilise un conteneur stable.
        let costs_body = this.querySelector('[data-hse-costs-view-body]');
        if (!costs_body) {
          costs_body = _mk_el('div');
          costs_body.dataset.hseCostsViewBody = '1';
          this.appendChild(costs_body);
        }
        // Passer le hass actuel et les données
        window.hse_costs_view.render_costs(costs_body, resolved_data, this._hass);
      } else {
        // Fallback minimaliste si costs.view pas chargé
        const c = _mk_el('div', 'hse_card');
        c.appendChild(_mk_el('div', 'hse_subtitle', 'costs.view.js non chargé.'));
        this.appendChild(c);
      }
    }
  }

  // ── Helper DOM léger ─────────────────────────────────────────────────
  function _mk_el(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  customElements.define('hse-tab-costs', HseTabCosts);
  console.info('[HSE] hse-tab-costs registered');
})();
