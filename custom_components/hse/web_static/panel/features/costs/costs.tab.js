/* costs.tab.js — Custom element hse-tab-costs
   Phase 1D — HSE Frontend Refonte
   Migré depuis costs.view.js — cycle de vie via hse_live_store
   Ne jamais vider le formulaire compare lors d'un recalcul.
   Dépend de: window.hse_live_store, window.hse_live_service, window.hse_costs_view
*/
/* costs.tab.js — Phase 1D | hse-tab-costs
   Dépend de: hse_live_store, hse_live_service, hse_costs_view
*/
(function () {
  if (customElements.get('hse-tab-costs')) return;
  const DOMAIN = 'costs';

  class HseTabCosts extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._panel = null;
      this._unsubs = [];
      this._raf = false;
      this._state = {
        view: 'summary',
        loading: false,
        error: null,
        data: null,
        compare: { loading: false, result: null, error: null, params: { period: 'month', mode: 'period' } },
      };
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
        s.subscribe(DOMAIN, 'data',    (v) => { this._state.data    = v;    this._schedule_render(); }),
        s.subscribe(DOMAIN, 'loading', (v) => { this._state.loading = !!v;  this._schedule_render(); }),
        s.subscribe(DOMAIN, 'error',   (v) => { this._state.error   = v;    this._schedule_render(); }),
      );
    }

    _unsubscribe() {
      for (const u of this._unsubs) try { u(); } catch (_) {}
      this._unsubs = [];
    }

    /* Crée la structure stable une seule fois pour éviter tout flash/scroll-jack */
    _build_skeleton() {
      if (this.querySelector('[data-hse-costs-toolbar]')) return;
      const toolbar_card = _el('div', 'hse_card');
      const toolbar = _el('div', 'hse_toolbar');
      const btn = _el('button', 'hse_button hse_button_primary', 'Rafraîchir');
      btn.addEventListener('click', () => window.hse_live_service?.refresh(DOMAIN));
      toolbar.appendChild(btn);
      toolbar_card.dataset.hseCostsToolbar = '1';
      toolbar_card.appendChild(toolbar);
      this.appendChild(toolbar_card);

      const body = _el('div');
      body.dataset.hseCostsViewBody = '1';
      this.appendChild(body);
    }

    _schedule_render() {
      if (this._raf) return;
      this._raf = true;
      window.requestAnimationFrame(() => { this._raf = false; this._render(); });
    }

    _render() {
      if (!this.isConnected) return;
      const { data, loading, error } = this._state;

      // Mettre à jour le bouton Rafraîchir sans toucher au body
      const btn = this.querySelector('[data-hse-costs-toolbar] button');
      if (btn) { btn.disabled = loading; btn.textContent = loading ? '…' : 'Rafraîchir'; }

      const body = this.querySelector('[data-hse-costs-view-body]');
      if (!body) return;

      if (loading && !data) {
        body.innerHTML = '';
        body.appendChild(_el('div', 'hse_card', null, [_el('div', 'hse_subtitle', 'Chargement des coûts…')]));
        return;
      }
      if (error && !data) {
        body.innerHTML = '';
        const c = _el('div', 'hse_card');
        c.appendChild(_el('div', 'hse_kpi_title', 'Erreur'));
        c.appendChild(_el('pre', 'hse_code', String(error)));
        body.appendChild(c);
        return;
      }
      if (!data) {
        body.innerHTML = '';
        body.appendChild(_el('div', 'hse_card', null, [_el('div', 'hse_subtitle', 'Aucune donnée disponible.')]));
        return;
      }

      // Déléguer à costs.view — NE PAS vider body si déjà rendu avec données
      if (window.hse_costs_view?.render_costs) {
        window.hse_costs_view.render_costs(body, data, this._hass);
      }
    }
  }

  function _el(tag, cls, text, children) {
    const el = document.createElement(tag);
    if (cls)  el.className = cls;
    if (text != null) el.textContent = text;
    if (children) for (const c of children) el.appendChild(c);
    return el;
  }

  customElements.define('hse-tab-costs', HseTabCosts);
  console.info('[HSE] hse-tab-costs registered');
})();