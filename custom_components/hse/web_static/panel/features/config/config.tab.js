/* config.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.config
   D\u00e9pend de : hse_config_view, hse_config_state
*/
(function () {
  if (!window.hse_tabs_registry) window.hse_tabs_registry = {};
  if (window.hse_tabs_registry.config) return;

  let _container = null;
  let _hass      = null;
  let _unsub     = null;

  function _unsubscribe() {
    if (typeof _unsub === 'function') { try { _unsub(); } catch (_) {} }
    _unsub = null;
  }

  window.hse_tabs_registry.config = {
    mount(container, hass) {
      _container = container;
      _hass      = hass;
      if (window.hse_config_view?.render_config) {
        window.hse_config_view.render_config(container, hass);
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module configuration en cours de chargement\u2026</div></div>';
      }
      // Abonnement optionnel aux changements de state de config
      if (window.hse_config_state?.subscribe) {
        _unsub = window.hse_config_state.subscribe(() => {
          window.hse_config_view?.update?.(_container, _hass);
        });
      }
    },

    update_hass(hass) {
      _hass = hass;
      window.hse_config_view?.update_hass?.(_container, hass);
    },

    unmount() {
      _unsubscribe();
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: config registered');
})();
