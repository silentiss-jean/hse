/* config.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.config
   Dépend de : hse_config_view, hse_config_api

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   Contrat view : window.hse_config_view.render_config(container, model, on_action)
     - model     : objet complet passé à config.view.js
     - on_action : function(action, payload)

   Méthodes hse_config_api réelles :
     fetch_pricing(hass)                        → { pricing, pricing_defaults }
     set_pricing(hass, pricing)                 → ok
     clear_pricing(hass)                        → ok
     fetch_catalogue(hass)                      → catalogue
     refresh_catalogue(hass)                    → ok
     set_reference_total(hass, entity_id|null)  → ok
     get_reference_total_status(hass, eid|null) → status

   Polling référence :
     Toutes les 4s, si le statut est ni "ready" ni "failed" (ou absent),
     on appelle get_reference_total_status() et on re-render.
     Le polling s'arrête au unmount() ou quand status ∈ {ready, failed}.
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.config) return;

  let _container = null;
  let _hass      = null;
  let _model     = null;
  let _raf       = false;
  let _poll_timer = null;

  // ─── helpers ───────────────────────────────────────────────────────────────

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
      // scan_result initialisé avec la structure vide attendue par config.view.js
      scan_result:                   { integrations: [], candidates: [], suggested_cost_entity_ids: [], suggested_summary: null },
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
      _container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module configuration en cours de chargement…</div></div>';
    }
  }

  // ─── polling statut référence ──────────────────────────────────────────────
  // Appelé toutes les 4s tant que le statut n'est pas terminal.
  // S'arrête si _container est null (unmount) ou status ∈ {ready, failed}.

  function _poll_ref_status_stop() {
    if (_poll_timer) { clearInterval(_poll_timer); _poll_timer = null; }
  }

  function _poll_ref_status_start() {
    _poll_ref_status_stop();
    _poll_timer = setInterval(async () => {
      if (!_container || !_model) { _poll_ref_status_stop(); return; }

      const eid = _model.current_reference_entity_id || _model.selected_reference_entity_id;
      if (!eid) return;

      // Arrêt si statut terminal déjà connu
      const cur_status = String(_model.reference_status?.status || '').toLowerCase();
      if (cur_status === 'ready' || cur_status === 'failed') {
        _poll_ref_status_stop();
        return;
      }

      try {
        const status = await window.hse_config_api?.get_reference_total_status?.(_hass, eid);
        if (!_model) return;
        if (status) {
          _model.reference_status       = status;
          _model.reference_status_error = null;
          _schedule_render();
          // Arrêt du polling si statut terminal atteint
          const s = String(status.status || '').toLowerCase();
          if (s === 'ready' || s === 'failed') _poll_ref_status_stop();
        }
      } catch (e) {
        if (_model) {
          _model.reference_status_error = String(e);
          _schedule_render();
        }
      }
    }, 4000);
  }

  // ─── _do_refresh : charge pricing + catalogue en parallèle ────────────────

  async function _do_refresh() {
    if (!_model) return;
    _model.loading = true;
    _model.error   = null;
    _schedule_render();
    try {
      const [pricingResp, catalogueResp] = await Promise.all([
        window.hse_config_api?.fetch_pricing?.(_hass).catch((e) => { console.error('[HSE] config.tab: fetch_pricing', e); return null; }),
        window.hse_config_api?.fetch_catalogue?.(_hass).catch((e) => { console.error('[HSE] config.tab: fetch_catalogue', e); return null; }),
      ]);

      if (!_model) return; // unmounté entre-temps

      // ── pricing ──
      if (pricingResp && typeof pricingResp === 'object') {
        if (pricingResp.pricing          != null) _model.pricing          = pricingResp.pricing;
        if (pricingResp.pricing_defaults != null) _model.pricing_defaults = pricingResp.pricing_defaults;
        // Certains backends retournent le pricing directement (sans enveloppe)
        if (pricingResp.contract_type != null && _model.pricing == null) {
          _model.pricing = pricingResp;
        }
      }

      // ── catalogue → scan_result + current_reference_entity_id ──
      if (catalogueResp && typeof catalogueResp === 'object') {
        _model.catalogue = catalogueResp;

        // Extraire les candidats depuis le catalogue si présents
        if (Array.isArray(catalogueResp.candidates)) {
          _model.scan_result = {
            integrations:              catalogueResp.integrations              || [],
            candidates:                catalogueResp.candidates                || [],
            suggested_cost_entity_ids: catalogueResp.suggested_cost_entity_ids || [],
            suggested_summary:         catalogueResp.suggested_summary          || null,
          };
        } else if (catalogueResp.scan_result && typeof catalogueResp.scan_result === 'object') {
          _model.scan_result = catalogueResp.scan_result;
        }

        // Référence courante depuis le catalogue (via helper exposé par config.view.js)
        const refEid = window.hse_config_view?._current_reference_entity_id?.(catalogueResp) ?? null;
        if (refEid != null) _model.current_reference_entity_id = refEid;
      }

      // ── statut initial de la référence courante ──
      const eid = _model.current_reference_entity_id || _model.selected_reference_entity_id;
      if (eid) {
        // D'abord chercher dans le catalogue (snapshot disponible immédiatement)
        const snap = window.hse_config_view?._reference_status_from_catalogue?.(_model.catalogue, eid) ?? null;
        if (snap) _model.reference_status = snap;

        // Puis interroger le endpoint de statut
        try {
          const status = await window.hse_config_api?.get_reference_total_status?.(_hass, eid);
          if (_model && status) {
            _model.reference_status       = status;
            _model.reference_status_error = null;
          }
        } catch (e) {
          if (_model) _model.reference_status_error = String(e);
        }
      }

      // ── Démarrer le polling si le statut n'est pas encore terminal ──
      const s = String(_model.reference_status?.status || '').toLowerCase();
      if (eid && s !== 'ready' && s !== 'failed') {
        _poll_ref_status_start();
      } else {
        _poll_ref_status_stop();
      }

    } catch (err) {
      if (_model) _model.error = String(err);
      console.error('[HSE] config.tab: _do_refresh error', err);
    } finally {
      if (_model) _model.loading = false;
    }
  }

  // ─── on_action ────────────────────────────────────────────────────────────

  async function on_action(action, payload) {
    if (!_model) return;
    switch (action) {

      // ── Rafraîchit tout (pricing + catalogue + statut ref) ──
      case 'refresh': {
        await _do_refresh();
        _schedule_render();
        break;
      }

      // ── Sélection locale de la référence dans le <select> ──
      case 'select_reference': {
        _model.selected_reference_entity_id = payload ?? null;
        _schedule_render();
        break;
      }

      // ── Sauvegarde référence → set_reference_total ──
      case 'save_reference': {
        _model.saving  = true;
        _model.error   = null;
        _model.message = null;
        _poll_ref_status_stop(); // on arrête le poll existant avant le save
        _schedule_render();
        try {
          await window.hse_config_api.set_reference_total(
            _hass,
            _model.selected_reference_entity_id ?? null
          );
          _model.message = 'Référence sauvegardée.';
          await _do_refresh(); // recharge + redémarre le polling si besoin
        } catch (err) {
          _model.error = String(err);
          console.error('[HSE] config.tab: save_reference error', err);
        } finally {
          _model.saving = false;
          _schedule_render();
        }
        break;
      }

      // ── Suppression référence → set_reference_total(null) ──
      case 'clear_reference': {
        _model.saving  = true;
        _model.error   = null;
        _model.message = null;
        _poll_ref_status_stop();
        _schedule_render();
        try {
          await window.hse_config_api.set_reference_total(_hass, null);
          _model.selected_reference_entity_id = null;
          _model.reference_status             = null;
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

      // ── Mutation locale du brouillon tarifs ──
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

      // ── Sauvegarde tarifs → set_pricing ──
      case 'pricing_save': {
        _model.pricing_saving  = true;
        _model.pricing_error   = null;
        _model.pricing_message = null;
        _schedule_render();
        try {
          const draft    = _model.pricing_draft || _model.pricing || {};
          const cost_ids = _model.pricing_draft?.cost_entity_ids ?? (_model.pricing?.cost_entity_ids ?? []);
          await window.hse_config_api.set_pricing(_hass, { ...draft, cost_entity_ids: cost_ids });
          _model.pricing_message = 'Tarifs sauvegardés.';
          _model.pricing_draft   = null;
          await _do_refresh();
        } catch (err) {
          _model.pricing_error = String(err);
          console.error('[HSE] config.tab: pricing_save error', err);
        } finally {
          _model.pricing_saving = false;
          _schedule_render();
        }
        break;
      }

      // ── Effacer tarifs → clear_pricing ──
      case 'pricing_clear': {
        _model.pricing_saving  = true;
        _model.pricing_error   = null;
        _model.pricing_message = null;
        _schedule_render();
        try {
          await window.hse_config_api.clear_pricing(_hass);
          _model.pricing         = null;
          _model.pricing_draft   = null;
          _model.pricing_message = 'Tarifs effacés.';
          await _do_refresh();
        } catch (err) {
          _model.pricing_error = String(err);
          console.error('[HSE] config.tab: pricing_clear error', err);
        } finally {
          _model.pricing_saving = false;
          _schedule_render();
        }
        break;
      }

      // ── Filtre capteurs coûts ──
      case 'cost_filter': {
        _model.cost_filter_q = payload ?? '';
        _schedule_render();
        break;
      }

      // ── Sélection automatique capteurs coûts ──
      case 'cost_auto_select': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        _model.pricing_draft.cost_entity_ids = payload.entity_ids ?? [];
        _schedule_render();
        break;
      }

      // ── Ajout capteur coût ──
      case 'pricing_list_add': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const ids_add = Array.isArray(_model.pricing_draft.cost_entity_ids)
          ? _model.pricing_draft.cost_entity_ids.slice() : [];
        if (!ids_add.includes(payload.entity_id)) ids_add.push(payload.entity_id);
        _model.pricing_draft.cost_entity_ids = ids_add;
        _schedule_render();
        break;
      }

      // ── Retrait capteur coût ──
      case 'pricing_list_remove': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const ids_rm = Array.isArray(_model.pricing_draft.cost_entity_ids)
          ? _model.pricing_draft.cost_entity_ids.slice() : [];
        _model.pricing_draft.cost_entity_ids = ids_rm.filter((x) => x !== payload.entity_id);
        _schedule_render();
        break;
      }

      // ── Remplacement capteur coût ──
      case 'pricing_list_replace': {
        if (!_model.pricing_draft) {
          _model.pricing_draft = Object.assign({}, _model.pricing || _model.pricing_defaults || {});
        }
        const ids_rep = Array.isArray(_model.pricing_draft.cost_entity_ids)
          ? _model.pricing_draft.cost_entity_ids.slice() : [];
        const idx = ids_rep.indexOf(payload.from_entity_id);
        if (idx !== -1) ids_rep[idx] = payload.to_entity_id;
        else if (!ids_rep.includes(payload.to_entity_id)) ids_rep.push(payload.to_entity_id);
        _model.pricing_draft.cost_entity_ids = ids_rep;
        _schedule_render();
        break;
      }

      default:
        console.warn('[HSE] config.tab: unknown action', action, payload);
    }
  }

  // ─── registry ─────────────────────────────────────────────────────────────

  window.hse_tabs_registry.config = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      _init_model();
      _render(); // rendu immédiat avec état vide (évite flash "en cours de chargement")
      _do_refresh().then(() => _schedule_render()); // puis charge les données réelles
    },

    update_hass(hass) {
      _hass = hass;
    },

    unmount() {
      _poll_ref_status_stop();
      _container = null;
      _hass      = null;
      _model     = null;
    },
  };

  console.info('[HSE] tab module: config registered');
})();
