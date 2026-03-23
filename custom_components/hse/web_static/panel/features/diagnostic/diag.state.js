(function () {
  /**
   * diag.state.js — Phase 8
   *
   * Bridge d'état pour l'onglet Diagnostic.
   * Pose les clés diag.* dans window.hse_store et expose
   * window.hse_diag_state pour que hse_panel.js puisse
   * lire/écrire sans accéder au store directement.
   *
   * Clés gérées dans hse_store (préfixe "diag.") :
   *   diag.loading        — fetch en cours (bool)
   *   diag.data           — catalogue complet (objet|null)
   *   diag.error          — dernière erreur fetch (string|null)
   *   diag.filter_q       — filtre texte (string)
   *   diag.selected       — map item_id→bool sélectionnés (objet)
   *   diag.advanced       — mode avancé (bool)
   *   diag.last_request   — dernière requête envoyée (objet|null)
   *   diag.last_response  — dernière réponse reçue (objet|null)
   *   diag.last_action    — label de la dernière action (string|null)
   *   diag.check_loading  — check cohérence en cours (bool)
   *   diag.check_error    — erreur check cohérence (string|null)
   *   diag.check_result   — résultat check cohérence (objet|null)
   *
   * Clés localStorage persistées :
   *   hse_diag_filter_q   → diag.filter_q
   *   hse_diag_advanced   → diag.advanced
   *   hse_diag_selected   → diag.selected
   *
   * API exposée via window.hse_diag_state :
   *   .get(key)               — lit une clé diag.*
   *   .set(key, value)        — écrit une clé diag.*
   *   .patch(obj)             — écrit plusieurs clés en une fois
   *   .get_state()            — retourne un snapshot complet de l'état
   *   .begin_fetch()          — loading=true, error=null
   *   .end_fetch(data, error) — loading=false, data|error
   *   .begin_check()          — check_loading=true, check_error=null
   *   .end_check(result, err) — check_loading=false, check_result|check_error
   *   .set_selected(map)      — remplace la sélection complète
   *   .clear_selected()       — vide la sélection
   *   .reset_check()          — remet check_loading/error/result à zéro
   */

  const PREFIX = 'diag.';

  // ── Helpers localStorage ────────────────────────────────────────────────────
  function _ls_get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function _ls_set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  // ── Accès store ─────────────────────────────────────────────────────────────
  function _s() { return window.hse_store || null; }

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
  function _restore_from_storage() {
    const filter_q  = _ls_get('hse_diag_filter_q') || '';
    const advanced  = (_ls_get('hse_diag_advanced') || '0') === '1';

    let selected = {};
    try {
      const raw = _ls_get('hse_diag_selected');
      if (raw) selected = JSON.parse(raw) || {};
    } catch (_) {}

    _set('loading',       false);
    _set('data',          null);
    _set('error',         null);
    _set('filter_q',      filter_q);
    _set('selected',      selected);
    _set('advanced',      advanced);
    _set('last_request',  null);
    _set('last_response', null);
    _set('last_action',   null);
    _set('check_loading', false);
    _set('check_error',   null);
    _set('check_result',  null);
  }

  // ── Abonnements store → localStorage ────────────────────────────────────────
  function _subscribe_persistence() {
    const s = _s();
    if (!s || typeof s.subscribe !== 'function') return;

    s.subscribe(PREFIX + 'filter_q', (v) => {
      _ls_set('hse_diag_filter_q', v || '');
    });
    s.subscribe(PREFIX + 'advanced', (v) => {
      _ls_set('hse_diag_advanced', v ? '1' : '0');
    });
    s.subscribe(PREFIX + 'selected', (v) => {
      try { _ls_set('hse_diag_selected', JSON.stringify(v || {})); } catch (_) {}
    });
  }

  // ── API publique ─────────────────────────────────────────────────────────────
  function _make_api() {
    return {
      get(key) {
        return _get(key, undefined);
      },

      set(key, value) {
        _set(key, value);
      },

      patch(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          _set(k, v);
        }
      },

      get_state() {
        return {
          loading:       !!_get('loading',       false),
          data:          _get('data',            null),
          error:         _get('error',           null),
          filter_q:      _get('filter_q',        ''),
          selected:      _get('selected',        {}),
          advanced:      !!_get('advanced',      false),
          last_request:  _get('last_request',    null),
          last_response: _get('last_response',   null),
          last_action:   _get('last_action',     null),
          check_loading: !!_get('check_loading', false),
          check_error:   _get('check_error',     null),
          check_result:  _get('check_result',    null),
        };
      },

      /** Phase 8 — Début fetch catalogue. */
      begin_fetch() {
        _set('loading', true);
        _set('error',   null);
      },

      /** Phase 8 — Fin fetch catalogue. */
      end_fetch(data, error) {
        _set('loading', false);
        _set('data',    error ? _get('data', null) : (data ?? null));
        _set('error',   error ?? null);
      },

      /** Phase 8 — Début check cohérence. */
      begin_check() {
        _set('check_loading', true);
        _set('check_error',   null);
      },

      /** Phase 8 — Fin check cohérence. */
      end_check(result, error) {
        _set('check_loading', false);
        _set('check_result',  error ? null : (result ?? null));
        _set('check_error',   error ?? null);
      },

      /** Phase 8 — Remplace la sélection complète. */
      set_selected(map) {
        _set('selected', map && typeof map === 'object' ? map : {});
      },

      /** Phase 8 — Vide la sélection. */
      clear_selected() {
        _set('selected', {});
      },

      /** Remet check_loading / check_error / check_result à zéro. */
      reset_check() {
        _set('check_loading', false);
        _set('check_error',   null);
        _set('check_result',  null);
      },
    };
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  const store = _s();

  if (store) {
    _restore_from_storage();
    _subscribe_persistence();
    window.hse_diag_state = _make_api();
    console.debug('[HSE] diag.state.js loaded — window.hse_diag_state ready (Phase 8)');
  } else {
    console.warn('[HSE] diag.state.js: hse_store non disponible — mode dégradé');

    let _local = {
      loading: false, data: null, error: null,
      filter_q: _ls_get('hse_diag_filter_q') || '',
      advanced: (_ls_get('hse_diag_advanced') || '0') === '1',
      selected: (() => { try { return JSON.parse(_ls_get('hse_diag_selected') || '{}') || {}; } catch(_){return {};} })(),
      last_request: null, last_response: null, last_action: null,
      check_loading: false, check_error: null, check_result: null,
    };

    window.hse_diag_state = {
      get(key)           { return _local[key]; },
      set(key, value)    {
        _local[key] = value;
        if (key === 'filter_q') _ls_set('hse_diag_filter_q', value || '');
        if (key === 'advanced') _ls_set('hse_diag_advanced', value ? '1' : '0');
        if (key === 'selected') { try { _ls_set('hse_diag_selected', JSON.stringify(value || {})); } catch(_){} }
      },
      patch(obj)           { if (obj) for (const [k,v] of Object.entries(obj)) this.set(k, v); },
      get_state()          { return { ..._local }; },
      begin_fetch()        { _local.loading = true; _local.error = null; },
      end_fetch(data, err) { _local.loading = false; _local.data = err ? _local.data : (data ?? null); _local.error = err ?? null; },
      begin_check()        { _local.check_loading = true; _local.check_error = null; },
      end_check(res, err)  { _local.check_loading = false; _local.check_result = err ? null : (res ?? null); _local.check_error = err ?? null; },
      set_selected(map)    { _local.selected = (map && typeof map === 'object') ? map : {}; try { _ls_set('hse_diag_selected', JSON.stringify(_local.selected)); } catch(_){} },
      clear_selected()     { _local.selected = {}; try { _ls_set('hse_diag_selected', '{}'); } catch(_){} },
      reset_check()        { _local.check_loading = false; _local.check_error = null; _local.check_result = null; },
    };
  }
})();
