/* scan.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.scan
   Dépend de : hse_scan_view, hse_scan_api

   Contrat ctx : { hass, panel, actions, live_store, live_service }
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.scan) return;

  let _container = null;
  let _hass      = null;

  window.hse_tabs_registry.scan = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      if (window.hse_scan_view?.render_scan) {
        window.hse_scan_view.render_scan(container, _hass);
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
