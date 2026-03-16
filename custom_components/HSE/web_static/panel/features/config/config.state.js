(function () {
  /**
   * config.state.js — Phase 3
   *
   * Expose window.hse_config_state : helpers de lecture/écriture
   * de l'état de l'onglet Configuration dans window.hse_store.
   *
   * Clés du store (préfixe "config.") :
   *
   *   config.scan_result                  — résultat du scan capteurs (objet)
   *   config.catalogue                    — catalogue enrichissement (objet)
   *   config.pricing                      — tarifs sauvegardés (objet)
   *   config.pricing_draft                — brouillon tarifs en cours de saisie (objet)
   *   config.pricing_defaults             — valeurs par défaut tarifs (objet)
   *   config.selected_reference_entity_id — entity_id choisi pour la référence (string|null)
   *   config.current_reference_entity_id  — entity_id de référence actif en base (string|null)
   *   config.reference_status             — workflow status de la référence (objet|null)
   *   config.reference_status_error       — dernière erreur du statut ref (string|null)
   *   config.loading                      — chargement en cours (bool)
   *   config.saving                       — sauvegarde référence en cours (bool)
   *   config.pricing_saving               — sauvegarde tarifs en cours (bool)
   *   config.message                      — message de feedback (string|null)
   *   config.error                        — dernière erreur générale (string|null)
   *   config.pricing_message              — feedback spécifique tarifs (string|null)
   *   config.pricing_error                — erreur spécifique tarifs (string|null)
   *   config.cost_filter_q                — filtre texte capteurs de calcul (string)
   */

  const PREFIX = 'config.';

  function _s() {
    return window.hse_store || null;
  }

  function _get(key, fallback) {
    const s = _s();
    if (!s) return fallback;
    const v = s.get(PREFIX + key);
    return v == null ? fallback : v;
  }

  function _set(key, value) {
    const s = _s();
    if (s) s.set(PREFIX + key, value);
  }

  function _patch(key, partial) {
    const s = _s();
    if (s) s.patch(PREFIX + key, partial);
  }

  /**
   * Construit l'objet `model` attendu par config.view.js → render_config().
   * Fallback transparent : si le store n'est pas encore initialisé,
   * on fusionne avec model_fallback (passé depuis hse_panel.js).
   */
  function get_model(model_fallback) {
    const fb = model_fallback || {};
    const s = _s();
    if (!s) return fb;

    return {
      scan_result:                  _get('scan_result',                  fb.scan_result                  ?? null),
      catalogue:                    _get('catalogue',                    fb.catalogue                    ?? null),
      pricing:                      _get('pricing',                      fb.pricing                      ?? null),
      pricing_draft:                _get('pricing_draft',                fb.pricing_draft                ?? null),
      pricing_defaults:             _get('pricing_defaults',             fb.pricing_defaults             ?? null),
      selected_reference_entity_id: _get('selected_reference_entity_id',fb.selected_reference_entity_id ?? null),
      current_reference_entity_id:  _get('current_reference_entity_id', fb.current_reference_entity_id  ?? null),
      reference_status:             _get('reference_status',             fb.reference_status             ?? null),
      reference_status_error:       _get('reference_status_error',       fb.reference_status_error       ?? null),
      loading:                      !!_get('loading',                    fb.loading),
      saving:                       !!_get('saving',                     fb.saving),
      pricing_saving:               !!_get('pricing_saving',             fb.pricing_saving),
      message:                      _get('message',                      fb.message                      ?? null),
      error:                        _get('error',                        fb.error                        ?? null),
      pricing_message:              _get('pricing_message',              fb.pricing_message              ?? null),
      pricing_error:                _get('pricing_error',                fb.pricing_error                ?? null),
      cost_filter_q:                _get('cost_filter_q',                fb.cost_filter_q                ?? ''),
    };
  }

  /** Remet à zéro les flags transitoires après une action. */
  function clear_feedback() {
    _set('message',        null);
    _set('error',          null);
    _set('pricing_message',null);
    _set('pricing_error',  null);
  }

  /** Démarre / termine un chargement. */
  function begin_loading() { _set('loading', true); }
  function end_loading()   { _set('loading', false); }

  /** Démarre / termine une sauvegarde référence. */
  function begin_saving()  { _set('saving', true); }
  function end_saving()    { _set('saving', false); }

  /** Démarre / termine une sauvegarde tarifs. */
  function begin_pricing_save()  { _set('pricing_saving', true); }
  function end_pricing_save()    { _set('pricing_saving', false); }

  window.hse_config_state = {
    get_model,
    clear_feedback,
    begin_loading,  end_loading,
    begin_saving,   end_saving,
    begin_pricing_save, end_pricing_save,
    // Accès direct si besoin
    get: _get,
    set: _set,
    patch: _patch,
  };
})();
