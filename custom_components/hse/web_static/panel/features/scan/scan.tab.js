/* scan.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.scan
   D\u00e9pend de : hse_scan_view, hse_scan_api
*/
(function () {
  if (!window.hse_tabs_registry) window.hse_tabs_registry = {};
  if (window.hse_tabs_registry.scan) return;

  let _container = null;
  let _hass      = null;

  window.hse_tabs_registry.scan = {
    mount(container, hass) {
      _container = container;
      _hass      = hass;
      if (window.hse_scan_view?.render_scan) {
        window.hse_scan_view.render_scan(container, hass);
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module d\u00e9tection en cours de chargement\u2026</div></div>';
      }
    },

    update_hass(hass) {
      _hass = hass;
      window.hse_scan_view?.update_hass?.(_container, hass);
    },

    unmount() {
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: scan registered');
})();
