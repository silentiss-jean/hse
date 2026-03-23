/**
 * hse.store.js — Micro-store réactif HSE
 *
 * Source de vérité centrale pour le frontend HSE.
 * Remplace progressivement les états éparpillés dans hse_panel.js
 * (this._org_state, this._config_state, this._diag_state, etc.)
 *
 * Principe :
 *   store.set(key, value)    → met à jour l'état + notifie les abonnés
 *   store.get(key)           → lit l'état courant
 *   store.subscribe(key, fn) → s'abonner aux changements d'une clé
 *                             retourne une fonction unsubscribe()
 *   store.freeze(key)        → gèle une clé (les set() sont ignorés)
 *   store.unfreeze(key)      → dégèle une clé
 *
 * Usage typique (protection race condition async) :
 *   store.freeze('meta_draft');           // avant confirm()
 *   const ok = window.confirm("…");
 *   if (!ok) { store.unfreeze('meta_draft'); return; }
 *   await fetch(...);
 *   store.unfreeze('meta_draft');
 */

(function () {
  class HseStore {
    constructor() {
      this._state = Object.create(null);
      this._listeners = new Map();  // key → Set<fn>
      this._frozen = new Set();     // clés gelées (immunisées aux set)
    }

    // ── Lecture ──────────────────────────────────────────────────────────────

    get(key) {
      return this._state[key];
    }

    /** Lecture d'un sous-chemin pointillé : store.get_path('org.meta_draft.rooms') */
    get_path(path) {
      const parts = String(path || '').split('.').filter(Boolean);
      let cur = this._state;
      for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[p];
      }
      return cur;
    }

    // ── Écriture ─────────────────────────────────────────────────────────────

    /**
     * Met à jour la clé et notifie les abonnés.
     * no-op si la clé est gelée (freeze) ou si la valeur est identique (deep equal JSON).
     */
    set(key, value) {
      if (this._frozen.has(key)) return false;

      // Comparaison shallow rapide avant de sérialiser
      const prev = this._state[key];
      if (prev === value) return false;

      // Deep-equal sur objets/tableaux pour éviter les notifications inutiles
      if (prev !== undefined && value !== undefined) {
        try {
          if (JSON.stringify(prev) === JSON.stringify(value)) return false;
        } catch (_) {
          // Objet non sérialisable → on laisse passer
        }
      }

      this._state[key] = value;
      this._notify(key, value, prev);
      return true;
    }

    /**
     * Patch partiel d'un objet existant (Object.assign shallow).
     * Utile pour mettre à jour un seul champ d'un state-object
     * sans réécrire la référence entière.
     */
    patch(key, partial) {
      if (this._frozen.has(key)) return false;
      const prev = this._state[key];
      const next = Object.assign({}, prev, partial);
      this._state[key] = next;
      this._notify(key, next, prev);
      return true;
    }

    // ── Gel (protection race condition) ──────────────────────────────────────

    /**
     * Gèle une clé : les appels store.set(key, …) sont ignorés.
     * À utiliser avant un window.confirm() pour éviter qu'un
     * polling concurrent écrase le draft en cours d'édition.
     */
    freeze(key) {
      this._frozen.add(key);
    }

    /** Dégèle une clé. */
    unfreeze(key) {
      this._frozen.delete(key);
    }

    is_frozen(key) {
      return this._frozen.has(key);
    }

    // ── Abonnements ──────────────────────────────────────────────────────────

    /**
     * S'abonner aux changements d'une clé.
     * @param {string} key
     * @param {function(newValue, prevValue)} fn
     * @returns {function} unsubscribe — appeler pour se désabonner
     */
    subscribe(key, fn) {
      if (!this._listeners.has(key)) this._listeners.set(key, new Set());
      this._listeners.get(key).add(fn);
      return () => {
        const s = this._listeners.get(key);
        if (s) s.delete(fn);
      };
    }

    /**
     * S'abonner à plusieurs clés en une seule fois.
     * @param {string[]} keys
     * @param {function(key, newValue, prevValue)} fn
     * @returns {function} unsubscribe global
     */
    subscribe_many(keys, fn) {
      const unsubs = keys.map(k => this.subscribe(k, (nv, pv) => fn(k, nv, pv)));
      return () => unsubs.forEach(u => u());
    }

    // ── Utilitaires ──────────────────────────────────────────────────────────

    /** Snapshot sérialisé sûr d'une clé (deep clone par JSON). */
    snapshot(key) {
      const v = this._state[key];
      if (v == null) return v;
      try {
        return JSON.parse(JSON.stringify(v));
      } catch (_) {
        return v;
      }
    }

    /** Réinitialise tout le store (utile pour les tests). */
    _reset() {
      this._state = Object.create(null);
      this._listeners.clear();
      this._frozen.clear();
    }

    // ── Interne ──────────────────────────────────────────────────────────────

    _notify(key, newValue, prevValue) {
      const fns = this._listeners.get(key);
      if (!fns || !fns.size) return;
      for (const fn of fns) {
        try {
          fn(newValue, prevValue);
        } catch (err) {
          console.error(`[HseStore] subscriber error for key "${key}"`, err);
        }
      }
    }
  }

  // Singleton global — une seule instance partagée entre tous les modules
  window.hse_store = new HseStore();

  console.debug('[HSE] hse.store.js loaded — window.hse_store ready');
})();
