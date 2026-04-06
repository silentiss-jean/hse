/* custom.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.custom
   Dépend de : hse_custom_view, hse_custom_api (optionnel)

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   Contrat view : window.hse_custom_view.render_customisation(container, state, org_state_fallback, on_action)
     - state              : { theme, dynamic_bg, glass }
     - org_state_fallback : { preview_running, apply_running, show_raw,
                               rooms_filter_q, assignments_filter_q }
     - on_action          : function(action, payload)

   ATTENTION : la fonction s'appelle render_customisation (PAS render_custom).
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.custom) return;

  let _container          = null;
  let _hass               = null;
  let _state              = null;
  let _org_state_fallback = null;
  let _raf                = false;

  function _init_state() {
    _state = {
      theme:      'ha',
      dynamic_bg: true,
      glass:      false,
    };
    _org_state_fallback = {
      preview_running:      false,
      apply_running:        false,
      show_raw:             false,
      rooms_filter_q:       '',
      assignments_filter_q: '',
    };
  }

  function _schedule_render() {
    if (_raf) return;
    _raf = true;
    window.requestAnimationFrame(() => { _raf = false; _render(); });
  }

  function _render() {
    if (!_container || !_state) return;
    if (window.hse_custom_view?.render_customisation) {
      window.hse_custom_view.render_customisation(_container, _state, _org_state_fallback, on_action);
    } else {
      _container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module customisation en cours de chargement…</div></div>';
    }
  }

  async function on_action(action, payload) {
    if (!_state) return;
    switch (action) {

      case 'set_theme': {
        if (window.hse_panel_instance?._set_theme) {
          window.hse_panel_instance._set_theme(payload);
        }
        _state.theme = payload;
        _schedule_render();
        break;
      }

      case 'toggle_dynamic_bg': {
        _state.dynamic_bg = !_state.dynamic_bg;
        _schedule_render();
        break;
      }

      case 'toggle_glass': {
        _state.glass = !_state.glass;
        _schedule_render();
        break;
      }

      case 'org_refresh': {
        try {
          await window.hse_custom_api?.fetch_meta?.(_hass);
        } catch (err) {
          console.error('[HSE] custom.tab: org_refresh error', err);
        }
        _schedule_render();
        break;
      }

      case 'org_preview': {
        _org_state_fallback.preview_running = true;
        _schedule_render();
        try {
          await window.hse_custom_api?.preview?.(_hass, payload);
        } catch (err) {
          console.error('[HSE] custom.tab: org_preview error', err);
        } finally {
          _org_state_fallback.preview_running = false;
          _schedule_render();
        }
        break;
      }

      case 'org_apply': {
        _org_state_fallback.apply_running = true;
        _schedule_render();
        try {
          await window.hse_custom_api?.apply?.(_hass, payload?.apply_mode);
        } catch (err) {
          console.error('[HSE] custom.tab: org_apply error', err);
        } finally {
          _org_state_fallback.apply_running = false;
          _schedule_render();
        }
        break;
      }

      case 'org_save': {
        try {
          await window.hse_custom_api?.save?.(_hass, payload);
        } catch (err) {
          console.error('[HSE] custom.tab: org_save error', err);
        }
        _schedule_render();
        break;
      }

      case 'org_patch': {
        if (window.hse_store?.set) {
          window.hse_store.set(payload);
        } else {
          try {
            await window.hse_custom_api?.patch?.(_hass, payload);
          } catch (err) {
            console.error('[HSE] custom.tab: org_patch error', err);
          }
        }
        if (!payload?.no_render) _schedule_render();
        break;
      }

      case 'org_room_add': {
        try {
          await window.hse_custom_api?.room_add?.(_hass, payload);
        } catch (err) {
          console.error('[HSE] custom.tab: org_room_add error', err);
        }
        _schedule_render();
        break;
      }

      case 'org_room_delete': {
        try {
          await window.hse_custom_api?.room_delete?.(_hass, payload);
        } catch (err) {
          console.error('[HSE] custom.tab: org_room_delete error', err);
        }
        _schedule_render();
        break;
      }

      case 'org_type_create': {
        try {
          await window.hse_custom_api?.type_create?.(_hass, payload);
        } catch (err) {
          console.error('[HSE] custom.tab: org_type_create error', err);
        }
        _schedule_render();
        break;
      }

      case 'org_toggle_raw': {
        _org_state_fallback.show_raw = !_org_state_fallback.show_raw;
        _schedule_render();
        break;
      }

      case 'org_rerender': {
        _schedule_render();
        break;
      }

      default:
        console.warn('[HSE] custom.tab: unknown action', action, payload);
    }
  }

  window.hse_tabs_registry.custom = {
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
      _container          = null;
      _hass               = null;
      _state              = null;
      _org_state_fallback = null;
    },
  };

  console.info('[HSE] tab module: custom registered');
})();
