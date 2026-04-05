/* diagnostic.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.diagnostic
   Dépend de : hse_diagnostic_view, hse_diag_state
*/
(function () {
  if (!window.hse_tabs_registry) window.hse_tabs_registry = {};
  if (window.hse_tabs_registry.diagnostic) return;

  let _container = null;
  let _hass      = null;
  let _built     = false;

  window.hse_tabs_registry.diagnostic = {
    mount(container, hass) {
      _container = container;
      _hass      = hass;
      _built     = false;
      // Rendu initial via diagnostic view
      if (window.hse_diagnostic_view?.render_diagnostic) {
        window.hse_diagnostic_view.render_diagnostic(container, hass);
        _built = true;
      } else if (window.hse_diag_view?.render) {
        window.hse_diag_view.render(container, hass);
        _built = true;
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module diagnostic en cours de chargement\u2026</div></div>';
      }
    },

    update_hass(hass) {
      _hass = hass;
      if (!_container || !_built) return;
      // Propager hass si la vue expose une m\u00e9thode de mise \u00e0 jour
      window.hse_diagnostic_view?.update_hass?.(_container, hass);
    },

    unmount() {
      _container = null;
      _hass      = null;
      _built     = false;
    },
  };

  console.info('[HSE] tab module: diagnostic registered');
})();
