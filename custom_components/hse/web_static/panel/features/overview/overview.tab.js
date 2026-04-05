(function () {
  class HseTabOverview extends HTMLElement {
    constructor() {
      super();
      this._container = document.createElement('div');
      this._container.className = 'hse_page';
      this.appendChild(this._container);

      this._data = null;
      this._hass = null;
      this._unsub = null;
    }

    set hass(hass) {
      this._hass = hass;
      if (this._data && window.hse_overview_view?.patch_live) {
        window.hse_overview_view.patch_live(this._container, this._data, this._hass);
      }
    }

    set panel(panel) {
      this._panel = panel;
    }

    connectedCallback() {
      if (window.hse_live_store) {
        this._unsub = window.hse_live_store.subscribe(
          'overview',
          'data',
          (data) => {
            this._data = data;
            if (!data) return;
            if (this._container.dataset.hseOverviewBuilt === '1') {
              if (window.hse_overview_view?.patch_live) {
                window.hse_overview_view.patch_live(this._container, data, this._hass);
              }
            } else if (window.hse_overview_view?.render_overview) {
              window.hse_overview_view.render_overview(this._container, data, this._hass);
              this._container.dataset.hseOverviewBuilt = '1';
              window.hse_overview_state?.mark_built?.();
            }
          }
        );
      }

      if (!this._data && window.hse_live_store) {
        const existing = window.hse_live_store.get('overview', 'data');
        if (existing && window.hse_overview_view?.render_overview) {
          this._data = existing;
          window.hse_overview_view.render_overview(this._container, existing, this._hass);
        }
      }
    }

    disconnectedCallback() {
      if (typeof this._unsub === 'function') {
        try { this._unsub(); } catch (_) {}
      }
      this._unsub = null;
    }
  }

  if (!customElements.get('hse-tab-overview')) {
    customElements.define('hse-tab-overview', HseTabOverview);
  }
})();
