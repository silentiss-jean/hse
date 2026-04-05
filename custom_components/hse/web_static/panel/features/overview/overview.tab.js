/* overview.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.overview
   Dépend de : hse_live_store (via ctx), hse_overview_view, hse_overview_state

   Contrat ctx : { hass, panel, actions, live_store, live_service }
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.overview) return;

  let _container = null;
  let _hass      = null;
  let _unsub     = null;
  let _data      = null;
  let _built     = false;

  function _render(container, data, hass) {
    if (!data || !container) return;
    if (_built) {
      window.hse_overview_view?.patch_live?.(container, data, hass);
    } else {
      window.hse_overview_view?.render_overview?.(container, data, hass);
      _built = true;
      window.hse_overview_state?.mark_built?.();
    }
  }

  window.hse_tabs_registry.overview = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      _built     = false;
      _data      = null;

      const live = ctx.live_store ?? window.hse_live_store;
      if (live) {
        _unsub = live.subscribe('overview', 'data', (data) => {
          _data = data;
          _render(_container, _data, _hass);
        });
        const existing = live.get('overview', 'data');
        if (existing) {
          _data = existing;
          _render(_container, _data, _hass);
        }
      }
    },

    update_hass(hass) {
      _hass = hass;
      if (_data) window.hse_overview_view?.patch_live?.(_container, _data, hass);
    },

    unmount() {
      if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} }
      _unsub     = null;
      _container = null;
      _data      = null;
      _hass      = null;
      _built     = false;
    },
  };

  console.info('[HSE] tab module: overview registered');
})();
