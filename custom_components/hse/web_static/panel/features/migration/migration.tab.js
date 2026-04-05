/* migration.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.migration
   D\u00e9pend de : hse_migration_view, hse_migration_api
*/
(function () {
  if (!window.hse_tabs_registry) window.hse_tabs_registry = {};
  if (window.hse_tabs_registry.migration) return;

  let _container = null;
  let _hass      = null;

  window.hse_tabs_registry.migration = {
    mount(container, hass) {
      _container = container;
      _hass      = hass;
      if (window.hse_migration_view?.render_migration) {
        window.hse_migration_view.render_migration(container, hass);
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module migration capteurs en cours de chargement\u2026</div></div>';
      }
    },

    update_hass(hass) {
      _hass = hass;
      window.hse_migration_view?.update_hass?.(_container, hass);
    },

    unmount() {
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: migration registered');
})();
