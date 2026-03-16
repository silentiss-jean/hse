(function () {
  /**
   * diag.state.js — Phase 3
   *
   * Expose window.hse_diag_state : helpers de lecture/écriture
   * de l'état de l'onglet Diagnostic dans window.hse_store.
   *
   * Clés du store (préfixe "diag.") :
   *
   *   diag.filter_q       — filtre texte (string)
   *   diag.selected       — map item_id → bool des items cochés (objet)
   *   diag.advanced       — mode debug activé (bool)
   *   diag.check_loading  — analyse de cohérence en cours (bool)
   *   diag.check_error    — dernière erreur de check (string|null)
   *   diag.check_result   — résultat du contrôle de cohérence (objet|null)
   *   diag.last_action    — dernière action effectuée (string|null)  [debug]
   *   diag.last_request   — dernière requête envoyée (objet|null)    [debug]
   *   diag.last_response  — dernière réponse reçue (objet|null)      [debug]
   */

  const PREFIX = 'diag.';

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

  /**
   * Construit l'objet `state` attendu par diagnostic.view.js → render_diagnostic().
   * Fallback transparent si le store n'est pas encore chargé.
   */
  function get_state(state_fallback) {
    const fb = state_fallback || {};
    const s = _s();
    if (!s) return fb;

    return {
      filter_q:      _get('filter_q',      fb.filter_q      ?? ''),
      selected:      _get('selected',      fb.selected      ?? {}),
      advanced:      !!_get('advanced',    fb.advanced),
      check_loading: !!_get('check_loading',fb.check_loading),
      check_error:   _get('check_error',   fb.check_error   ?? null),
      check_result:  _get('check_result',  fb.check_result  ?? null),
      last_action:   _get('last_action',   fb.last_action   ?? null),
      last_request:  _get('last_request',  fb.last_request  ?? null),
      last_response: _get('last_response', fb.last_response ?? null),
    };
  }

  /** Coche / décoche un item dans la sélection. */
  function set_selected(item_id, checked) {
    const s = _s();
    if (!s) return;
    const current = s.get(PREFIX + 'selected') || {};
    const next = Object.assign({}, current, { [item_id]: !!checked });
    s.set(PREFIX + 'selected', next);
  }

  /** Vide la sélection entière. */
  function clear_selected() {
    _set('selected', {});
  }

  /** Démarre / termine un check de cohérence. */
  function begin_check()  { _set('check_loading', true);  _set('check_error', null); }
  function end_check(result, error) {
    _set('check_loading', false);
    _set('check_result',  error ? null : (result ?? null));
    _set('check_error',   error ?? null);
  }

  window.hse_diag_state = {
    get_state,
    set_selected,
    clear_selected,
    begin_check,
    end_check,
    // Accès direct
    get: _get,
    set: _set,
  };
})();
