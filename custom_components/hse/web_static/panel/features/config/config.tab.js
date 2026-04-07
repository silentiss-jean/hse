/* config.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.config
   Dépend de : hse_config_view, hse_config_api

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   Contrat view : window.hse_config_view.render_config(container, model, on_action)
     - model     : objet complet passé à config.view.js
     - on_action : function(action, payload)

   fix #5  — souscription à hse_config_state.subscribe() supprimée :
             elle était morte (hse_config_state n'est jamais alimenté).
   fix #7  — _do_refresh() pré-remplit pricing_draft depuis pricing || pricing_defaults
             si et seulement si pricing_draft est encore null au retour du refresh.
             Cela garantit que les champs numériques sont pré-remplis à l'affichage initial.
   fix #8  — update_hass() ne déclenche plus de re-render systématique (toutes les ~2s
             HA envoie un hass frais). Re-render uniquement si le modèle est prêt ET
             qu'aucun chargement n'est en cours, pour ne pas perturber le patch-DOM de
             config.view.js (select ouvert, input en cours de saisie…).
   fix #9  — pricing_save : on sauvegarde les cost_entity_ids depuis pricing_draft EN
             PREMIER, puis on remet pricing_draft = null, puis on appelle _do_refresh().
             L'ancien ordre (null avant refresh) faisait perdre les ids si _do_refresh
             remontait pricing sans cost_entity_ids.
   fix #10 — pricing_clear remet pricing_draft = null ET force un re-render complet
             (data-hse-config-built reset) pour que la pricing card se reconstruise
             avec les valeurs sauvegardées, pas le draft annulé.
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.config) return;

  let _container = null;
  let _hass      = null;
  let _model     = null;
  let _raf       = false;

  function _init_model() {
    _model = {
      loading:                       false,
      saving:                        false,
      pricing_saving:                false,
      error:                         null,
      message:                       null,
      pricing:                       null,
      pricing_draft:                 null,
      pricing_defaults:              null,
      pricing_message:               null,
      pricing_error:                 null,
      scan_result:                   null,
      catalogue:                     null,
      current_reference_entity_id:   null,
      selected_reference_entity_id:  null,
      reference_status:              null,
      reference_status_error:        null,
      cost_filter_q:                 '',
    };
  }

  function _schedule_render() {
    if (_raf) return;
    _raf = true;
    window.requestAnimationFrame(() => { _raf = false; _render(); });
  }

  function _render() {
    if (!_container || !_model) return;
    if (window.hse_config_view?.render_config) {
      window.hse_config_view.render_config(_container, _model, on_action);
    } else {
      _container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module configuration en cours de chargement\u2026</div></div>';
    }
  }

  // fix #10 — reset le flag de construction initiale pour forcer un rebuild complet
  function _reset_build_flag() {
    if (_container) _container.removeAttribute('data-hse-config-built');
  }

  async function _do_refresh() {
    if (!_model) return;
    _model.loading = true;
    _schedule_render();
    try {
      if (window.hse_config_api?.fetch_config) {
        const data = await window.hse_config_api.fetch_config(_hass);
        if (data && _model) {
          _model.pricing                      = data.pricing ?? _model.pricing;
          _model.pricing_defaults             = data.pricing_defaults ?? _model.pricing_defaults;
          _model.scan_result                  = data.scan_result ?? _model.scan_result;
          _model.catalogue                    = data.catalogue ?? _model.catalogue;
          _model.current_reference_entity_id  = data.current_reference_entity_id ?? _model.current_reference_entity_id;
          _model.reference_status             = data.reference_status ?? _model.reference_status;

          // fix #7 — pré-remplir pricing_draft si encore null après le refresh
          // (premier chargement ou après pricing_save/pricing_clear)
          if (_model.pricing_draft === null) {
            const base = _model.pricing || _model.pricing_defaults;
            if (base && typeof base === 'object') {
              _model.pricing_draft = Object.assign({}, base);
            }
          }
        }
      }
    } catch (err) {
      if (_model) _model.error = String(err);
      console.error('[HSE] config.tab: fetch_config error', err);
    } finally {
      if (_model) _model.loading = false;
    }
  }

  async function on_action(action, payload) {
    if (!_model) return;
    switch (action) {

      case 'refresh': {
        await _do_refresh();
        _schedule_render();
        break;
      }

      case 'select_reference': {
        _model.selected_reference_entity_id = payload ?? null;
        _schedule_render();
        break;
      }

      case 'save_reference': {
        _model.saving  = true;
        _model.error   = null;
        _model.message = null;
        _schedule_render();
        try {
          await window.hse_config_api?.save_reference?.(_hass, _model.selected_reference_entity_id);
          _model.message = 'Référence sauvegardée.';
          await _do_refresh();
        } catch (err) {
          _model.error = String(err);
          console.error('[HSE] config.tab: save_reference error', err);
        } finally {
          _model.saving = false;
          _schedule_render();
        }
        break;
      }

      case 'clear_reference': {
        _model.saving  = true;
        _model.error   = null;
        _model.message = null;
        _schedule_render();
        try {
          await window.hse_config_api?.save_reference?.(_hass, null);
          _model.selected_reference_entity_id = null;
          _model.message = 'Référence supprimée.';
          await _do_refresh();
        } catch (err) {
          _model.error = String(err);
          console.error('[HSE] config.tab: clear_reference error', err);
        } finally {
          _model.saving = false;
          _schedule_render();
        }
        break;
      }

      case 'pricing_patch': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const parts = String(payload.path || '').split('.').filter(Boolean);
        let cur = _model.pricing_draft;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        if (parts.length) cur[parts[parts.length - 1]] = payload.value;
        if (!payload.no_render) _schedule_render();
        break;
      }

      case 'pricing_save': {
        // fix #9 — capturer les ids et le draft AVANT de remettre pricing_draft = null
        const draft_to_save  = _model.pricing_draft || _model.pricing || {};
        const cost_entity_ids = Array.isArray(draft_to_save.cost_entity_ids)
          ? draft_to_save.cost_entity_ids
          : (_model.pricing?.cost_entity_ids ?? []);

        _model.pricing_saving  = true;
        _model.pricing_error   = null;
        _model.pricing_message = null;
        _schedule_render();
        try {
          await window.hse_config_api?.save_pricing?.(_hass, { ...draft_to_save, cost_entity_ids });
          _model.pricing_message = 'Tarifs sauvegardés.';
          _model.pricing_draft   = null;   // reset après sauvegarde réussie
          await _do_refresh();             // re-remplit pricing_draft depuis pricing (fix #7)
        } catch (err) {
          _model.pricing_error = String(err);
          console.error('[HSE] config.tab: pricing_save error', err);
        } finally {
          _model.pricing_saving = false;
          _schedule_render();
        }
        break;
      }

      case 'pricing_clear': {
        // fix #10 — annuler le draft : remettre à null + reset build flag pour forcer
        // un rebuild complet de la pricing card avec les valeurs sauvegardées
        _model.pricing_draft   = null;
        _model.pricing_message = null;
        _model.pricing_error   = null;
        // Pré-remplir immédiatement depuis pricing/pricing_defaults existants
        const base = _model.pricing || _model.pricing_defaults;
        if (base && typeof base === 'object') {
          _model.pricing_draft = Object.assign({}, base);
        }
        _reset_build_flag();
        _schedule_render();
        break;
      }

      case 'cost_filter': {
        _model.cost_filter_q = payload ?? '';
        _schedule_render();
        break;
      }

      case 'cost_auto_select': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        _model.pricing_draft.cost_entity_ids = payload.entity_ids ?? [];
        _schedule_render();
        break;
      }

      case 'pricing_list_add': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const ids = Array.isArray(_model.pricing_draft.cost_entity_ids)
          ? _model.pricing_draft.cost_entity_ids.slice() : [];
        if (!ids.includes(payload.entity_id)) ids.push(payload.entity_id);
        _model.pricing_draft.cost_entity_ids = ids;
        _schedule_render();
        break;
      }

      case 'pricing_list_remove': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const ids = Array.isArray(_model.pricing_draft.cost_entity_ids)
          ? _model.pricing_draft.cost_entity_ids.slice() : [];
        _model.pricing_draft.cost_entity_ids = ids.filter((x) => x !== payload.entity_id);
        _schedule_render();
        break;
      }

      case 'pricing_list_replace': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const ids = Array.isArray(_model.pricing_draft.cost_entity_ids)
          ? _model.pricing_draft.cost_entity_ids.slice() : [];
        const idx = ids.indexOf(payload.from_entity_id);
        if (idx !== -1) ids[idx] = payload.to_entity_id;
        else if (!ids.includes(payload.to_entity_id)) ids.push(payload.to_entity_id);
        _model.pricing_draft.cost_entity_ids = ids;
        _schedule_render();
        break;
      }

      default:
        console.warn('[HSE] config.tab: unknown action', action, payload);
    }
  }

  window.hse_tabs_registry.config = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      _init_model();
      _render();
      _do_refresh().then(() => _schedule_render());
    },

    update_hass(hass) {
      _hass = hass;
      // fix #8 — ne pas re-render si un chargement est en cours (évite de perturber
      // le patch-DOM de config.view.js pendant fetch_config / save / pricing_save).
      if (_model && !_model.loading && !_model.saving && !_model.pricing_saving) {
        _schedule_render();
      }
    },

    unmount() {
      _container = null;
      _hass      = null;
      _model     = null;
    },
  };

  console.info('[HSE] tab module: config registered');
})();
