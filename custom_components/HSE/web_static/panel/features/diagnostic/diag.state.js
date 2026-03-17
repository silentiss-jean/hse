(function () {
  /**
   * diag.state.js — Phase 7
   *
   * Expose window.hse_diag_state : helpers de lecture/écriture
   * de l'état de l'onglet Diagnostic dans window.hse_store.
   *
   * Phase 7 : persistance localStorage gérée ici via des subscribers.
   * hse_panel.js n'a plus besoin de faire de _storage_set/get pour le diag.
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
   *
   * Clés localStorage persistées :
   *   hse_diag_filter_q   → diag.filter_q
   *   hse_diag_advanced   → diag.advanced
   *   hse_diag_selected   → diag.selected
   */

  const PREFIX = 'diag.';

  // ── localStorage helpers ────────────────────────────────────────────────────
  function _ls_get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function _ls_set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

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

  // ── Restauration initiale depuis localStorage ───────────────────────────────
  // Appelée une fois au chargement du module, avant que hse_panel ne démarre.
  function _restore_from_storage() {
    const filter_q = _ls_get('hse_diag_filter_q') || '';
    const advanced = (_ls_get('hse_diag_advanced') || '0') === '1';
    let selected = {};
    try {
      const raw = _ls_get('hse_diag_selected');
      if (raw) selected = JSON.parse(raw) || {};
    } catch (_) {}

    _set('filter_q', filter_q);
    _set('advanced', advanced);
    _set('selected', selected);
  }

  // ── Abonnements store → localStorage ───────────────────────────────────────
  // Appelé une fois que le store est prêt (juste après _restore_from_storage).
  function _subscribe_persistence() {
    const s = _s();
    if (!s || typeof s.subscribe !== 'function') return;

    s.subscribe(PREFIX + 'filter_q', (v) => {
      _ls_set('hse_diag_filter_q', v ?? '');
    });
    s.subscribe(PREFIX + 'advanced', (v) => {
      _ls_set('hse_diag_advanced', v ? '1' : '0');
    });
    s.subscribe(PREFIX + 'selected', (v) => {
      try { _ls_set('hse_diag_selected', JSON.stringify(v || {})); } catch (_) {}
    });
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

  // ── Init ────────────────────────────────────────────────────────────────────
  _restore_from_storage();
  _subscribe_persistence();

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
