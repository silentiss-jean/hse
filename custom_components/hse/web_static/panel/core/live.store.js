/* live.store.js — Store UI léger par domaine avec abonnements fins
   Phase 1A — HSE Frontend Refonte
   global: window.hse_live_store
*/
(function () {
  const DOMAINS = ['overview', 'costs', 'config', 'diag', 'scan', 'theme'];

  // _data[domain][key] = value
  // _subs[domain][key] = Set<callback>
  const _data = {};
  const _subs = {};

  for (const d of DOMAINS) {
    _data[d] = {};
    _subs[d] = {};
  }

  function _ensure_domain(domain) {
    if (!_data[domain]) { _data[domain] = {}; _subs[domain] = {}; }
  }

  function set(domain, key, value) {
    _ensure_domain(domain);
    const prev = _data[domain][key];
    // Ne notifier que si la valeur change (comparaison shallow)
    if (prev === value) return;
    _data[domain][key] = value;
    const cbs = _subs[domain][key];
    if (cbs && cbs.size) {
      for (const cb of [...cbs]) {
        try { cb(value, prev); } catch (e) { console.error('[hse_live_store] subscriber error', e); }
      }
    }
  }

  function get(domain, key) {
    _ensure_domain(domain);
    return _data[domain][key];
  }

  /**
   * subscribe(domain, key, cb) → unsub_fn
   * cb est appelé immédiatement avec la valeur courante, puis à chaque changement.
   */
  function subscribe(domain, key, cb) {
    _ensure_domain(domain);
    if (!_subs[domain][key]) _subs[domain][key] = new Set();
    _subs[domain][key].add(cb);
    // Appel immédiat avec valeur courante
    try { cb(_data[domain][key], undefined); } catch (e) { console.error('[hse_live_store] initial subscribe error', e); }
    return function unsub() {
      if (_subs[domain] && _subs[domain][key]) _subs[domain][key].delete(cb);
    };
  }

  /** Invalide toutes les clés d'un domaine et notifie les abonnés (value → undefined) */
  function invalidate(domain) {
    _ensure_domain(domain);
    const keys = Object.keys(_data[domain]);
    for (const key of keys) {
      const prev = _data[domain][key];
      _data[domain][key] = undefined;
      const cbs = _subs[domain][key];
      if (cbs && cbs.size) {
        for (const cb of [...cbs]) {
          try { cb(undefined, prev); } catch (e) { console.error('[hse_live_store] invalidate error', e); }
        }
      }
    }
  }

  /** Supprime toutes les données d'un domaine sans notifier */
  function clear(domain) {
    _ensure_domain(domain);
    _data[domain] = {};
  }

  window.hse_live_store = { set, get, subscribe, invalidate, clear };
  console.info('[HSE] live.store.js ready');
})();
