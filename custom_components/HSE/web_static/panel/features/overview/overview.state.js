(function () {
  /**
   * overview.state.js — Phase 9
   *
   * Expose window.hse_overview_state : helpers de lecture/écriture
   * de l'état de l'onglet Accueil (overview) dans window.hse_store.
   *
   * Résout le scroll-jack : au lieu de clear() + rebuild complet toutes les
   * 30s, le subscriber overview.data appelle patch_live() sur le DOM existant.
   *
   * Clés du store (préfixe "overview.") :
   *
   *   overview.data        — réponse dashboard complète (objet|null)
   *   overview.loading     — fetch en cours (bool)
   *   overview.error       — dernière erreur fetch (string|null)
   *   overview.tax_mode    — "ht"|"ttc" (string)
   *   overview.costs_open  — section coûts par capteur dépliée (bool)
   *
   * Clés localStorage persistées :
   *   hse_overview_tax_mode   → overview.tax_mode
   *   hse_overview_costs_open → overview.costs_open
   */

  const PREFIX = 'overview.';

  function _ls_get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function _ls_set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

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

  // ── Restauration initiale depuis localStorage ──────────────────────────────
  function _restore_from_storage() {
    const saved_mode = _ls_get('hse_overview_tax_mode') || '';
    const tax_mode = (saved_mode === 'ht' || saved_mode === 'ttc') ? saved_mode : null;
    const costs_open = (_ls_get('hse_overview_costs_open') || '0') === '1';

    _set('data',        null);
    _set('loading',     false);
    _set('error',       null);
    if (tax_mode) _set('tax_mode', tax_mode);
    _set('costs_open',  costs_open);
  }

  // ── Abonnements store → localStorage ──────────────────────────────────────
  function _subscribe_persistence() {
    const s = _s();
    if (!s || typeof s.subscribe !== 'function') return;

    s.subscribe(PREFIX + 'tax_mode', (v) => {
      if (v === 'ht' || v === 'ttc') _ls_set('hse_overview_tax_mode', v);
    });
    s.subscribe(PREFIX + 'costs_open', (v) => {
      _ls_set('hse_overview_costs_open', v ? '1' : '0');
    });
  }

  // ── Fetch helpers (appelés par hse_panel.js) ──────────────────────────────
  function begin_fetch() {
    _set('loading', true);
    _set('error',   null);
  }

  function end_fetch(data, error) {
    _set('loading', false);
    _set('data',    error ? null : (data ?? null));
    _set('error',   error ?? null);
  }

  function get_state(fallback) {
    const fb = fallback || {};
    const s = _s();
    if (!s) return fb;
    return {
      data:        _get('data',        fb.data        ?? null),
      loading:     !!_get('loading',   fb.loading),
      error:       _get('error',       fb.error       ?? null),
      tax_mode:    _get('tax_mode',    fb.tax_mode    ?? null),
      costs_open:  !!_get('costs_open',fb.costs_open),
    };
  }

  // ── Enregistrement du container overview pour patch_live ─────────────────
  // hse_panel.js appelle register_container(el) une seule fois au premier
  // render. Le subscriber overview.data appellera patch_live dessus.
  let _container_ref = null;
  let _hass_ref = null;

  function register_container(container, hass) {
    _container_ref = container || null;
    _hass_ref      = hass      || null;
  }

  function update_hass(hass) {
    _hass_ref = hass || null;
  }

  // Subscriber overview.data → patch_live en-place (sans clear)
  function _subscribe_patch_live() {
    const s = _s();
    if (!s || typeof s.subscribe !== 'function') return;

    s.subscribe(PREFIX + 'data', (data) => {
      if (!_container_ref || !data) return;
      if (typeof window.hse_overview_view?.patch_live !== 'function') return;
      try {
        window.hse_overview_view.patch_live(_container_ref, { dashboard: data?.dashboard ?? data }, _hass_ref);
      } catch (_) {}
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  _restore_from_storage();
  _subscribe_persistence();
  _subscribe_patch_live();

  window.hse_overview_state = {
    get_state,
    begin_fetch,
    end_fetch,
    register_container,
    update_hass,
    get: _get,
    set: _set,
  };
})();
