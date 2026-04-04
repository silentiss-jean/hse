/* live.store.js — Phase 1A | global: window.hse_live_store
   Store UI léger par domaine avec abonnements fins.
   Domaines : overview, costs, config, diag, scan, theme
   Règle : notifier abonnés UNIQUEMENT si valeur change (===)
*/
(function () {
  "use strict";
  if (window.hse_live_store) return;

  const DOMAINS = ["overview", "costs", "config", "diag", "scan", "theme"];

  // _data[domain][key] = valeur courante
  const _data = {};
  // _subs[domain][key] = Set<callback>
  const _subs = {};

  function _ensure(domain) {
    if (!_data[domain]) { _data[domain] = {}; _subs[domain] = {}; }
  }

  /**
   * set(domain, key, value)
   * Stocke la valeur et notifie les abonnés si elle a changé.
   */
  function set(domain, key, value) {
    _ensure(domain);
    const prev = _data[domain][key];
    if (prev === value) return;
    _data[domain][key] = value;
    const cbs = _subs[domain][key];
    if (cbs) for (const cb of [...cbs]) {
      try { cb(value); } catch (e) { console.error("[hse_live_store] set error", e); }
    }
  }

  /**
   * get(domain, key) -> valeur ou undefined
   */
  function get(domain, key) {
    return _data[domain]?.[key];
  }

  /**
   * subscribe(domain, key, cb) -> unsub_fn
   * S'abonne aux changements. Appel immédiat si valeur déjà présente.
   */
  function subscribe(domain, key, cb) {
    _ensure(domain);
    if (!_subs[domain][key]) _subs[domain][key] = new Set();
    _subs[domain][key].add(cb);
    // Appel immédiat si valeur déjà disponible
    const current = _data[domain][key];
    if (current !== undefined) {
      try { cb(current); } catch (e) { console.error("[hse_live_store] subscribe initial error", e); }
    }
    return function unsub() { _subs[domain]?.[key]?.delete(cb); };
  }

  /**
   * invalidate(domain)
   * Efface les valeurs d'un domaine et notifie les abonnés avec undefined.
   * Utile pour forcer un rechargement.
   */
  function invalidate(domain) {
    if (!_data[domain]) return;
    for (const key of Object.keys(_data[domain])) {
      _data[domain][key] = undefined;
      const cbs = _subs[domain]?.[key];
      if (cbs) for (const cb of [...cbs]) {
        try { cb(undefined); } catch (e) { console.error("[hse_live_store] invalidate error", e); }
      }
    }
  }

  /**
   * clear(domain)
   * Supprime toutes les données ET les abonnements d'un domaine.
   * Plus radical qu'invalidate.
   */
  function clear(domain) {
    _data[domain] = {};
    _subs[domain] = {};
  }

  window.hse_live_store = { set, get, subscribe, invalidate, clear };
  console.info("[HSE] hse_live_store ready — domaines :", DOMAINS.join(", "));
})();
