/**
 * hse_store.js — Store central réactif HSE (vanilla JS, zéro dépendance)
 *
 * Pattern : set(key, value) → notifie tous les subscribers de cette key.
 * Chaque feature s'abonne aux keys qui la concernent et fait des MAJ DOM
 * chirurgicales — plus jamais de clear() global.
 *
 * Keys réservées globales :
 *   hass_data       — objet hass courant (mis à jour par hse_panel)
 *   tab_active      — id de l'onglet actif (string)
 *   theme           — clé de thème active (string)
 *   custom_state    — { theme, dynamic_bg, glass }
 *   org_state       — état complet de l'organisation (draft, store, flags)
 *   config_state    — état complet de la configuration
 *   diag_state      — état du diagnostic
 *   scan_state      — état du scan
 *   migration_state — état de la migration
 *   overview_data   — données de l'overview / costs
 */

(function () {
  "use strict";

  // ─── État interne ───────────────────────────────────────────────────────────
  const _state = Object.create(null);

  // Map<key, Set<fn>>
  const _listeners = Object.create(null);

  // ─── API publique ────────────────────────────────────────────────────────────
  const HseStore = {
    /**
     * Lit la valeur courante d'une key.
     * @param {string} key
     * @returns {*}
     */
    get(key) {
      return _state[key];
    },

    /**
     * Écrit une valeur et notifie tous les abonnés de cette key.
     * Pour les objets, passe la référence directe (pas de clone).
     * Les subscribers reçoivent (value, key).
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
      _state[key] = value;
      const fns = _listeners[key];
      if (fns && fns.size) {
        fns.forEach((fn) => {
          try {
            fn(value, key);
          } catch (err) {
            console.error(`[HseStore] subscriber error on key "${key}"`, err);
          }
        });
      }
    },

    /**
     * Patch partiel d'un objet stocké.
     * Équivalent à : store.set(key, { ...store.get(key), ...patch })
     * @param {string} key
     * @param {Object} patch
     */
    patch(key, patch) {
      const current = _state[key];
      const next =
        current && typeof current === "object" && !Array.isArray(current)
          ? Object.assign({}, current, patch)
          : patch;
      HseStore.set(key, next);
    },

    /**
     * S'abonne aux changements d'une key.
     * Retourne une fonction de désabonnement.
     * @param {string} key
     * @param {Function} fn  — appelée avec (value, key)
     * @param {boolean} [immediate=false] — si true, appelle fn immédiatement avec la valeur actuelle
     * @returns {Function} unsubscribe
     */
    subscribe(key, fn, immediate = false) {
      if (!_listeners[key]) _listeners[key] = new Set();
      _listeners[key].add(fn);
      if (immediate && key in _state) {
        try {
          fn(_state[key], key);
        } catch (err) {
          console.error(`[HseStore] immediate subscriber error on key "${key}"`, err);
        }
      }
      return () => {
        if (_listeners[key]) _listeners[key].delete(fn);
      };
    },

    /**
     * S'abonne à plusieurs keys en une seule fois.
     * Retourne une fonction de désabonnement globale.
     * @param {string[]} keys
     * @param {Function} fn  — appelée avec (value, key)
     * @returns {Function} unsubscribe all
     */
    subscribe_many(keys, fn) {
      const unsubs = keys.map((k) => HseStore.subscribe(k, fn));
      return () => unsubs.forEach((u) => u());
    },

    /**
     * Vérifie si une key a déjà été initialisée.
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
      return key in _state;
    },

    /**
     * Retourne un snapshot de l'état complet (debug).
     * @returns {Object}
     */
    snapshot() {
      return Object.assign(Object.create(null), _state);
    },
  };

  // ─── Export global ───────────────────────────────────────────────────────────
  window.HseStore = HseStore;

  // Alias court pour usage interne
  window.hse_store = HseStore;

  console.debug("[HseStore] loaded");
})();
