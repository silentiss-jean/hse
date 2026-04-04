/* live.service.js — Service de polling léger par domaine
   Phase 1B — HSE Frontend Refonte
   global: window.hse_live_service
   Dépend de: window.hse_live_store
*/
/* live.service.js — Phase 1B | global: window.hse_live_service */
(function () {
  if (window.hse_live_service) return;
  const _jobs = {};
  let _hass = null;

  function _can_fetch() {
    if (!_hass) return false;
    const conn = _hass.connection;
    return !(conn && conn.connected === false);
  }

  function _schedule(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    job.timer = setTimeout(() => _tick(domain), job.interval_ms);
  }

  async function _tick(domain) {
    const job = _jobs[domain];
    if (!job || job.running) return;
    job.timer = null;

    if (document.hidden) { job.timer = setTimeout(() => _tick(domain), 2000); return; }
    if (!_can_fetch())   { job.timer = setTimeout(() => _tick(domain), 2000); return; }

    job.running = true;
    window.hse_live_store?.set(domain, 'loading', true);
    try {
      const result = await job.fn_fetch(_hass);
      window.hse_live_store?.set(domain, 'data', result);
      window.hse_live_store?.set(domain, 'error', null);
      window.hse_live_store?.set(domain, 'loading', false);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`[hse_live_service] ${domain}:`, msg);
      window.hse_live_store?.set(domain, 'error', msg);
      window.hse_live_store?.set(domain, 'loading', false);
    } finally {
      job.running = false;
      if (_jobs[domain]) _schedule(domain);
    }
  }

  function start(domain, fn_fetch, interval_ms) {
    if (_jobs[domain]) return;
    _jobs[domain] = { fn_fetch, interval_ms, timer: null, running: false };
    window.hse_live_store?.set(domain, 'loading', true);
    _tick(domain); // _tick vérifie _can_fetch() en interne
  }

  function stop(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    delete _jobs[domain];
  }

  function refresh(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    window.hse_live_store?.set(domain, 'loading', true);
    _tick(domain);
  }

  function update_hass(hass) { _hass = hass; }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const domain of Object.keys(_jobs)) {
      const job = _jobs[domain];
      if (job && !job.running && !job.timer && _can_fetch()) _tick(domain);
    }
  });

  window.hse_live_service = { start, stop, refresh, update_hass };
  console.info('[HSE] hse_live_service ready');
})();