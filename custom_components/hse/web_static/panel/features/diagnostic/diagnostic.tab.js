/* diagnostic.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.diagnostic
   Dépend de : hse_diag_view (window.hse_diag_view), hse_diagnostic_api

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   Contrat view : window.hse_diag_view.render_diagnostic(container, data, state, on_action)
     - data      : catalogue diagnostic (null si pas encore chargé)
     - state     : voir _init_state()
     - on_action : function(action, payload)

   ATTENTION : le global s'appelle window.hse_diag_view (PAS window.hse_diagnostic_view).
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.diagnostic) return;

  let _container = null;
  let _hass      = null;
  let _data      = null;
  let _state     = null;
  let _raf       = false;

  function _init_state() {
    _state = {
      filter_q:     '',
      selected:     {},
      advanced:     false,
      check_loading: false,
      check_error:   null,
      check_result:  null,
      last_action:   null,
      last_request:  null,
      last_response: null,
    };
  }

  function _schedule_render() {
    if (_raf) return;
    _raf = true;
    window.requestAnimationFrame(() => { _raf = false; _render(); });
  }

  function _render() {
    if (!_container) return;
    if (window.hse_diag_view?.render_diagnostic) {
      window.hse_diag_view.render_diagnostic(_container, _data, _state, on_action);
    } else {
      _container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module diagnostic en cours de chargement\u2026</div></div>';
    }
  }

  async function _do_refresh() {
    try {
      const result = await window.hse_diagnostic_api?.fetch_diagnostic(_hass);
      _data = result ?? null;
    } catch (err) {
      console.error('[HSE] diagnostic.tab: fetch_diagnostic error', err);
    }
  }

  function _filtered_item_ids() {
    if (!_data) return [];
    const items = _data.items ?? _data.catalogue ?? [];
    const q = (_state.filter_q || '').toLowerCase();
    return items
      .filter((it) => {
        if (!q) return true;
        return JSON.stringify(it).toLowerCase().includes(q);
      })
      .map((it) => it.item_id ?? it.id ?? it.entity_id);
  }

  async function on_action(action, payload) {
    if (!_state) return;
    switch (action) {

      case 'refresh': {
        await _do_refresh();
        _schedule_render();
        break;
      }

      case 'filter': {
        _state.filter_q = payload ?? '';
        _schedule_render();
        break;
      }

      case 'select': {
        _state.selected[payload.item_id] = !!payload.checked;
        _schedule_render();
        break;
      }

      case 'select_all_filtered': {
        for (const id of _filtered_item_ids()) _state.selected[id] = true;
        _schedule_render();
        break;
      }

      case 'select_none': {
        _state.selected = {};
        _schedule_render();
        break;
      }

      case 'toggle_advanced': {
        _state.advanced = !_state.advanced;
        _schedule_render();
        break;
      }

      case 'check_coherence': {
        _state.check_loading = true;
        _state.check_error   = null;
        _schedule_render();
        try {
          const result = await window.hse_diagnostic_api?.check_coherence?.(_hass, payload);
          _state.check_result = result ?? null;
        } catch (err) {
          _state.check_error = String(err);
          console.error('[HSE] diagnostic.tab: check_coherence error', err);
        } finally {
          _state.check_loading = false;
          _schedule_render();
        }
        break;
      }

      case 'mute': {
        _state.last_action = 'mute';
        try {
          _state.last_response = await window.hse_diagnostic_api?.mute?.(_hass, payload.item_id, payload.mute_until) ?? null;
        } catch (err) { console.error('[HSE] diagnostic.tab: mute error', err); }
        await _do_refresh();
        _schedule_render();
        break;
      }

      case 'removed': {
        _state.last_action = 'removed';
        try {
          _state.last_response = await window.hse_diagnostic_api?.removed?.(_hass, payload.item_id) ?? null;
        } catch (err) { console.error('[HSE] diagnostic.tab: removed error', err); }
        await _do_refresh();
        _schedule_render();
        break;
      }

      case 'bulk_mute': {
        _state.last_action = 'bulk_mute';
        const ids = Object.entries(_state.selected).filter(([, v]) => v).map(([k]) => k);
        try {
          _state.last_response = await window.hse_diagnostic_api?.bulk_mute?.(_hass, ids) ?? null;
        } catch (err) { console.error('[HSE] diagnostic.tab: bulk_mute error', err); }
        await _do_refresh();
        _schedule_render();
        break;
      }

      case 'bulk_removed': {
        _state.last_action = 'bulk_removed';
        const ids = Object.entries(_state.selected).filter(([, v]) => v).map(([k]) => k);
        try {
          _state.last_response = await window.hse_diagnostic_api?.bulk_removed?.(_hass, ids) ?? null;
        } catch (err) { console.error('[HSE] diagnostic.tab: bulk_removed error', err); }
        await _do_refresh();
        _schedule_render();
        break;
      }

      case 'consolidate_history': {
        _state.last_action = 'consolidate_history';
        try {
          _state.last_response = await window.hse_diagnostic_api?.consolidate?.(_hass, payload) ?? null;
        } catch (err) { console.error('[HSE] diagnostic.tab: consolidate_history error', err); }
        await _do_refresh();
        _schedule_render();
        break;
      }

      default:
        console.warn('[HSE] diagnostic.tab: unknown action', action, payload);
    }
  }

  window.hse_tabs_registry.diagnostic = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      _data      = null;
      _init_state();
      _render();
      // Chargement initial silencieux
      _do_refresh().then(() => _schedule_render());
    },

    update_hass(hass) {
      _hass = hass;
    },

    unmount() {
      _container = null;
      _hass      = null;
      _data      = null;
      _state     = null;
    },
  };

  console.info('[HSE] tab module: diagnostic registered');
})();
