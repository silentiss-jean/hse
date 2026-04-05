/* custom.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.custom
   D\u00e9pend de : hse_custom_view
*/
(function () {
  if (!window.hse_tabs_registry) window.hse_tabs_registry = {};
  if (window.hse_tabs_registry.custom) return;

  let _container = null;
  let _hass      = null;

  window.hse_tabs_registry.custom = {
    mount(container, hass) {
      _container = container;
      _hass      = hass;
      if (window.hse_custom_view?.render_custom) {
        window.hse_custom_view.render_custom(container, hass);
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module customisation en cours de chargement\u2026</div></div>';
      }
    },

    update_hass(hass) {
      _hass = hass;
      window.hse_custom_view?.update_hass?.(_container, hass);
    },

    unmount() {
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: custom registered');
})();
