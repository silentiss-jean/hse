/* migration.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.migration
   Dépend de : hse_migration_view, hse_migration_api

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   Contrat view : window.hse_migration_view.render_migration(container, state, on_action)
     - state     : { loading, error, last, active_yaml }
     - on_action : function(action, payload)
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.migration) return;

  let _container = null;
  let _hass      = null;
  let _state     = null;
  let _raf       = false;

  function _init_state() {
    _state = {
      loading:     false,
      error:       null,
      last:        null,
      active_yaml: null,
    };
  }

  function _schedule_render() {
    if (_raf) return;
    _raf = true;
    window.requestAnimationFrame(() => { _raf = false; _render(); });
  }

  function _render() {
    if (!_container) return;
    if (window.hse_migration_view?.render_migration) {
      window.hse_migration_view.render_migration(_container, _state, on_action);
    } else {
      _container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module migration capteurs en cours de chargement…</div></div>';
    }
  }

  async function on_action(action, payload) {
    if (!_state) return;
    switch (action) {

      case 'export': {
        _state.loading = true;
        _state.error   = null;
        _schedule_render();
        try {
          const result = await window.hse_migration_api?.export(_hass, payload?.option);
          _state.last        = result ?? null;
          _state.active_yaml = result?.yaml ?? result ?? null;
        } catch (err) {
          _state.error = String(err);
          console.error('[HSE] migration.tab: export error', err);
        } finally {
          _state.loading = false;
          _schedule_render();
        }
        break;
      }

      case 'preview': {
        _state.loading = true;
        _state.error   = null;
        _schedule_render();
        try {
          const result = await window.hse_migration_api?.preview(_hass, payload?.option);
          _state.last        = result ?? null;
          _state.active_yaml = result?.yaml ?? result ?? null;
        } catch (err) {
          _state.error = String(err);
          console.error('[HSE] migration.tab: preview error', err);
        } finally {
          _state.loading = false;
          _schedule_render();
        }
        break;
      }

      default:
        console.warn('[HSE] migration.tab: unknown action', action, payload);
    }
  }

  window.hse_tabs_registry.migration = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      _init_state();
      _render();
    },

    update_hass(hass) {
      _hass = hass;
    },

    unmount() {
      _container = null;
      _hass      = null;
      _state     = null;
    },
  };

  console.info('[HSE] tab module: migration registered');
})();
