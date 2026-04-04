/* live.store.js — Store UI léger par domaine avec abonnements fins
   Phase 1A — HSE Frontend Refonte
   global: window.hse_live_store
*/
/* live.store.js — Phase 1A | global: window.hse_live_store */
(function () {
  if (window.hse_live_store) return;
  const _data = {}, _subs = {};
  function _ensure(d) { if (!_data[d]) { _data[d] = {}; _subs[d] = {}; } }

  function set(domain, key, value) {
    _ensure(domain);
    const prev = _data[domain][key];
    if (prev === value) return; // notifier seulement si changement
    _data[domain][key] = value;
    const cbs = _subs[domain][key];
    if (cbs) for (const cb of [...cbs]) try { cb(value, prev); } catch (e) { console.error('[hse_live_store] error', e); }
  }

  function get(domain, key) { return _data[domain]?.[key]; }

  function subscribe(domain, key, cb) {
    _ensure(domain);
    if (!_subs[domain][key]) _subs[domain][key] = new Set();
    _subs[domain][key].add(cb);
    return () => _subs[domain]?.[key]?.delete(cb);
  }

  // Invalide = forcer notification avec valeur courante (sans l'effacer)
  function invalidate(domain) {
    if (!_data[domain]) return;
    for (const key of Object.keys(_data[domain])) {
      const val = _data[domain][key];
      const cbs = _subs[domain]?.[key];
      if (cbs) for (const cb of [...cbs]) try { cb(val, val); } catch (e) { console.error('[hse_live_store] invalidate error', e); }
    }
  }

  // Clear = efface + notifie abonnés avec undefined
  function clear(domain) {
    if (!_data[domain]) return;
    for (const key of Object.keys(_data[domain])) {
      const prev = _data[domain][key];
      delete _data[domain][key];
      const cbs = _subs[domain]?.[key];
      if (cbs) for (const cb of [...cbs]) try { cb(undefined, prev); } catch (e) { console.error('[hse_live_store] clear error', e); }
    }
  }

  window.hse_live_store = { set, get, subscribe, invalidate, clear };
  console.info('[HSE] hse_live_store ready');
})();