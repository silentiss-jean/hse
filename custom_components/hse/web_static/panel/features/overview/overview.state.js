(function () {
  /**
   * overview.state.js — Phase 9 (fix stale container_ref)
   *
   * Expose window.hse_overview_state : helpers de lecture/écriture
   * de l'état de l'onglet Accueil (overview) dans window.hse_store.
   *
   * CORRECTIF principal :
   *   - Les unsubscribers sont stockés et appelés avant chaque re-init.
   *   - register_container() invalide immédiatement _built si le container
   *     change (DOM recréé après changement d'onglet) → patch_live ne
   *     s'applique plus sur un container détaché.
   *   - end_fetch() appelle patch_live UNIQUEMENT si _container_ref est
   *     connecté au DOM (isConnected). Sinon on laisse _tab_overview()
   *     reconstruire via requestUpdate().
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

  // ── Refs container/hass ──────────────────────────────────────────────────
  let _container_ref = null;
  let _hass_ref      = null;
  let _built         = false; // true = render_overview a été appelé sur _container_ref

  // ── Unsubscribers (pour re-init propre) ───────────────────────────────────
  let _unsub_persistence = null;
  let _unsub_patch_live  = null;

  // ── Restauration initiale depuis localStorage ──────────────────────────────
  function _restore_from_storage() {
    const saved_mode = _ls_get('hse_overview_tax_mode') || '';
    const tax_mode   = (saved_mode === 'ht' || saved_mode === 'ttc') ? saved_mode : null;
    const costs_open = (_ls_get('hse_overview_costs_open') || '0') === '1';

    _set('data',       null);
    _set('loading',    false);
    _set('error',      null);
    if (tax_mode) _set('tax_mode', tax_mode);
    _set('costs_open', costs_open);
  }

  // ── Abonnements store → localStorage ──────────────────────────────────────
  function _subscribe_persistence() {
    // Unsubscribe les anciens avant de re-souscrire
    if (typeof _unsub_persistence === 'function') { try { _unsub_persistence(); } catch (_) {} }

    const s = _s();
    if (!s || typeof s.subscribe !== 'function') { _unsub_persistence = null; return; }

    const u1 = s.subscribe(PREFIX + 'tax_mode', (v) => {
      if (v === 'ht' || v === 'ttc') _ls_set('hse_overview_tax_mode', v);
    });
    const u2 = s.subscribe(PREFIX + 'costs_open', (v) => {
      _ls_set('hse_overview_costs_open', v ? '1' : '0');
    });
    _unsub_persistence = () => { try { u1(); } catch (_) {} try { u2(); } catch (_) {} };
  }

  // ── Fetch helpers (appelés par hse_panel.js) ──────────────────────────────
  function begin_fetch() {
    _set('loading', true);
    _set('error',   null);
  }

  function end_fetch(data, hass, container) {
    _set('loading', false);
    _set('error',   data?.error ?? null);

    // Si un container explicite est fourni, on le prend comme référence
    if (container && container !== _container_ref) {
      _container_ref = container;
      _built = !!container.dataset?.hseOverviewBuilt;
    }

    // Mise à jour hass si fourni
    if (hass) _hass_ref = hass;

    // On stocke la data EN DERNIER pour déclencher le subscriber patch_live
    // (qui vérifie _container_ref.isConnected)
    _set('data', data ?? null);
  }

  function get_state(fallback) {
    const fb = fallback || {};
    const s  = _s();
    if (!s) return fb;
    return {
      data:       _get('data',       fb.data       ?? null),
      loading:    !!_get('loading',  fb.loading),
      error:      _get('error',      fb.error      ?? null),
      tax_mode:   _get('tax_mode',   fb.tax_mode   ?? null),
      costs_open: !!_get('costs_open', fb.costs_open),
    };
  }

  // ── Enregistrement du container overview ─────────────────────────────────
  function register_container(container, hass) {
    // Si le container change (nouvel onglet, retour bureau), on invalide _built
    if (container !== _container_ref) {
      _built = false;
    }
    _container_ref = container || null;
    if (hass) _hass_ref = hass;
    // Synchronise le flag _built avec l'état réel du DOM
    if (_container_ref) {
      _built = !!_container_ref.dataset?.hseOverviewBuilt;
    }
  }

  function update_hass(hass) {
    _hass_ref = hass || null;
  }

  // ── Subscriber overview.data → patch_live ────────────────────────────────
  function _subscribe_patch_live() {
    // Unsubscribe l'ancien avant de re-souscrire
    if (typeof _unsub_patch_live === 'function') { try { _unsub_patch_live(); } catch (_) {} }

    const s = _s();
    if (!s || typeof s.subscribe !== 'function') { _unsub_patch_live = null; return; }

    _unsub_patch_live = s.subscribe(PREFIX + 'data', (data) => {
      if (!data) return;

      // Garde-fou : container doit être connecté au DOM
      if (!_container_ref || !_container_ref.isConnected) return;

      // Garde-fou : render_overview doit avoir déjà tourné une fois
      if (!_built) return;

      if (typeof window.hse_overview_view?.patch_live !== 'function') return;
      try {
        window.hse_overview_view.patch_live(_container_ref, { dashboard: data?.dashboard ?? data }, _hass_ref);
      } catch (_) {}
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function _init() {
    _container_ref = null;
    _hass_ref      = null;
    _built         = false;
    _restore_from_storage();
    _subscribe_persistence();
    _subscribe_patch_live();
  }

  _init(); // premier boot

  // Exposé pour que hse_panel._boot() puisse rappeler _init()
  // quand hse_store a été recréé (retour bureau virtuel).
  window.hse_overview_state_init = _init;

  window.hse_overview_state = {
    get_state,
    begin_fetch,
    end_fetch,
    register_container,
    update_hass,
    get: _get,
    set: _set,
    // Exposé pour que _tab_overview() puisse marquer le container comme built
    mark_built: () => { _built = true; },
  };
})();
