/* scan.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.scan
   Dépend de : hse_scan_view, hse_scan_api

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   Contrat view : window.hse_scan_view.render_scan(container, scan_result, state, on_action)
     - scan_result : objet résultat du dernier scan (null si jamais lancé)
     - state       : { scan_running, filter_q, open_all, groups_open }
     - on_action   : function(action, payload)
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.scan) return;

  let _container   = null;
  let _hass        = null;
  let _scan_result = null;
  let _state       = null;
  let _raf         = false;

  function _init_state() {
    _state = {
      scan_running: false,
      filter_q:    '',
      open_all:    false,
      groups_open: {},
    };
  }

  function _schedule_render() {
    if (_raf) return;
    _raf = true;
    window.requestAnimationFrame(() => { _raf = false; _render(); });
  }

  function _render() {
    if (!_container) return;
    if (window.hse_scan_view?.render_scan) {
      window.hse_scan_view.render_scan(_container, _scan_result, _state, on_action);
    } else {
      _container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module d\u00e9tection en cours de chargement\u2026</div></div>';
    }
  }

  async function on_action(action, payload) {
    if (!_state) return;
    switch (action) {

      case 'scan': {
        _state.scan_running = true;
        _schedule_render();
        try {
          const result = await window.hse_scan_api?.fetch_scan(_hass, {});
          _scan_result = result ?? null;
        } catch (err) {
          console.error('[HSE] scan.tab: fetch_scan error', err);
        } finally {
          _state.scan_running = false;
          _schedule_render();
        }
        break;
      }

      case 'filter': {
        _state.filter_q = payload ?? '';
        _schedule_render();
        break;
      }

      case 'open_all': {
        _state.open_all = true;
        _schedule_render();
        break;
      }

      case 'close_all': {
        _state.open_all  = false;
        _state.groups_open = {};
        _schedule_render();
        break;
      }

      case 'set_group_open': {
        _state.groups_open[payload.id] = payload.open;
        if (!payload.no_render) _schedule_render();
        break;
      }

      default:
        console.warn('[HSE] scan.tab: unknown action', action, payload);
    }
  }

  window.hse_tabs_registry.scan = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      _init_state();
      _scan_result = null;
      _render();
    },

    update_hass(hass) {
      _hass = hass;
      // Pas de re-render : le scan ne dépend pas directement du hass courant.
    },

    unmount() {
      _container   = null;
      _hass        = null;
      _scan_result = null;
      _state       = null;
    },
  };

  console.info('[HSE] tab module: scan registered');
})();
