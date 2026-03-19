(function () {
  /**
   * config.state.js — Phase 3
   *
   * Bridge d'état pour l'onglet Configuration.
   * Pose les clés config.* dans window.hse_store et expose
   * window.hse_config_state pour que hse_panel.js puisse
   * lire/écrire sans accéder au store directement.
   *
   * Clés gérées dans hse_store (préfixe "config.") :
   *   config.loading                    — chargement initial (bool)
   *   config.saving                     — sauvegarde référence en cours (bool)
   *   config.error                      — erreur générale (string|null)
   *   config.message                    — message général (string|null)
   *   config.pricing_saving             — sauvegarde tarifs en cours (bool)
   *   config.pricing_error              — erreur tarifs (string|null)
   *   config.pricing_message            — message tarifs (string|null)
   *   config.scan_result                — résultat scan (objet)
   *   config.catalogue                  — catalogue (objet|null)
   *   config.current_reference_entity_id  — entité référence courante (string|null)
   *   config.selected_reference_entity_id — entité référence sélectionnée (string|null)
   *   config.reference_status           — statut référence (objet|null)
   *   config.reference_status_error     — erreur statut référence (string|null)
   *   config.pricing                    — tarifs sauvegardés (objet|null)
   *   config.pricing_defaults           — tarifs défauts (objet|null)
   *   config.pricing_draft              — brouillon tarifs (objet|null)
   *   config.cost_filter_q              — filtre capteurs coûts (string)
   *
   * Clés localStorage persistées :
   *   hse_config_cost_filter_q → config.cost_filter_q
   *
   * API exposée via window.hse_config_state :
   *   .get(key)           — lit une clé config.*
   *   .set(key, value)    — écrit une clé config.*
   *   .patch(obj)         — écrit plusieurs clés en une fois
   *   .get_state()        — retourne un snapshot complet de l'état
   *   .reset()            — remet l'état à zéro (hors cost_filter_q)
   */

  const PREFIX = 'config.';

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

  // ── Valeurs initiales ───────────────────────────────────────────────────────
  const _initial = {
    loading:                      false,
    saving:                       false,
    error:                        null,
    message:                      null,
    pricing_saving:               false,
    pricing_error:                null,
    pricing_message:              null,
    scan_result:                  { integrations: [], candidates: [] },
    catalogue:                    null,
    current_reference_entity_id:  null,
    selected_reference_entity_id: null,
    reference_status:             null,
    reference_status_error:       null,
    pricing:                      null,
    pricing_defaults:             null,
    pricing_draft:                null,
    cost_filter_q:                '',
  };

  // ── Restauration initiale ───────────────────────────────────────────────────
  function _restore_from_storage() {
    const cost_filter_q = _ls_get('hse_config_cost_filter_q') || '';

    for (const [k, v] of Object.entries(_initial)) {
      _set(k, k === 'cost_filter_q' ? cost_filter_q : v);
    }
  }

  // ── Abonnements store → localStorage ────────────────────────────────────────
  function _subscribe_persistence() {
    const s = _s();
    if (!s || typeof s.subscribe !== 'function') return;

    s.subscribe(PREFIX + 'cost_filter_q', (v) => {
      _ls_set('hse_config_cost_filter_q', v || '');
    });
  }

  // ── API publique ─────────────────────────────────────────────────────────────
  function _make_api() {
    return {
      get(key) {
        return _get(key, _initial[key] ?? undefined);
      },

      set(key, value) {
        _set(key, value);
      },

      /**
       * Écrit plusieurs clés en une fois.
       * Ex: hse_config_state.patch({ loading: true, error: null })
       */
      patch(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          _set(k, v);
        }
      },

      /**
       * Retourne un snapshot complet de l'état config.
       * Compatible avec this._config_state dans hse_panel.js.
       */
      get_state() {
        return {
          loading:                      !!_get('loading',                      false),
          saving:                       !!_get('saving',                       false),
          error:                        _get('error',                          null),
          message:                      _get('message',                        null),
          pricing_saving:               !!_get('pricing_saving',               false),
          pricing_error:                _get('pricing_error',                  null),
          pricing_message:              _get('pricing_message',                null),
          scan_result:                  _get('scan_result',                    { integrations: [], candidates: [] }),
          catalogue:                    _get('catalogue',                      null),
          current_reference_entity_id:  _get('current_reference_entity_id',   null),
          selected_reference_entity_id: _get('selected_reference_entity_id',  null),
          reference_status:             _get('reference_status',               null),
          reference_status_error:       _get('reference_status_error',        null),
          pricing:                      _get('pricing',                        null),
          pricing_defaults:             _get('pricing_defaults',               null),
          pricing_draft:                _get('pricing_draft',                  null),
          cost_filter_q:                _get('cost_filter_q',                  ''),
        };
      },

      /**
       * Remet l'état config à zéro (hors cost_filter_q persisté).
       * Utile lors d'un changement d'onglet forcé.
       */
      reset() {
        for (const [k, v] of Object.entries(_initial)) {
          if (k === 'cost_filter_q') continue; // on garde la valeur persistée
          _set(k, v);
        }
      },
    };
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  const store = _s();

  if (store) {
    _restore_from_storage();
    _subscribe_persistence();
    window.hse_config_state = _make_api();
    console.debug('[HSE] config.state.js loaded — window.hse_config_state ready');
  } else {
    // Fallback dégradé : état local en mémoire
    console.warn('[HSE] config.state.js: hse_store non disponible — mode dégradé');

    const _local = {
      ..._initial,
      cost_filter_q: _ls_get('hse_config_cost_filter_q') || '',
    };

    window.hse_config_state = {
      get(key)        { return _local[key]; },
      set(key, value) {
        _local[key] = value;
        if (key === 'cost_filter_q') _ls_set('hse_config_cost_filter_q', value || '');
      },
      patch(obj)      { if (obj) for (const [k,v] of Object.entries(obj)) this.set(k, v); },
      get_state()     { return { ..._local }; },
      reset()         { for (const [k,v] of Object.entries(_initial)) { if (k !== 'cost_filter_q') _local[k] = v; } },
    };
  }
})();
