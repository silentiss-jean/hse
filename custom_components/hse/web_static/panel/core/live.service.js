/* live.service.js — Service de polling léger par domaine
   Phase 1B — HSE Frontend Refonte
   global: window.hse_live_service
   Dépend de: window.hse_live_store
*/
(function () {
  // _jobs[domain] = { fn_fetch, interval_ms, timer, running, paused }
  const _jobs = {};
  let _hass = null;

  function _can_fetch() {
    if (!_hass) return false;
    const conn = _hass.connection;
    if (!conn || conn.connected === false) return false;
    return true;
  }

  function _schedule(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    job.timer = setTimeout(() => _tick(domain), job.interval_ms);
  }

  async function _tick(domain) {
    const job = _jobs[domain];
    if (!job) return;
    job.timer = null;

    // Pause auto si onglet masqué
    if (document.hidden) {
      job.timer = setTimeout(() => _tick(domain), 2000);
      return;
    }

    if (!_can_fetch()) {
      console.info(`[hse_live_service] ${domain}: hass not ready, retry in 2s`);
      job.timer = setTimeout(() => _tick(domain), 2000);
      return;
    }

    if (job.running) return; // évite les appels concurrents
    job.running = true;
    try {
      const result = await job.fn_fetch(_hass);
      window.hse_live_store.set(domain, 'data', result);
      window.hse_live_store.set(domain, 'error', null);
      window.hse_live_store.set(domain, 'loading', false);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`[hse_live_service] ${domain} fetch error:`, msg);
      window.hse_live_store.set(domain, 'error', msg);
      window.hse_live_store.set(domain, 'loading', false);
    } finally {
      job.running = false;
      // Re-planifier seulement si le job existe encore
      if (_jobs[domain]) _schedule(domain);
    }
  }

  /**
   * start(domain, fn_fetch_async, interval_ms)
   * Lance le polling d'un domaine. Si déjà démarré, ne fait rien.
   */
  function start(domain, fn_fetch, interval_ms) {
    if (_jobs[domain]) return; // déjà actif
    _jobs[domain] = { fn_fetch, interval_ms, timer: null, running: false };
    // Déclenchement immédiat
    window.hse_live_store.set(domain, 'loading', true);
    _tick(domain);
  }

  /**
   * stop(domain)
   * Arrête le polling et nettoie le job.
   */
  function stop(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); }
    delete _jobs[domain];
  }

  /**
   * refresh(domain)
   * Force un fetch immédiat, même si le timer n'est pas encore écoulé.
   */
  function refresh(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    window.hse_live_store.set(domain, 'loading', true);
    _tick(domain);
  }

  /**
   * update_hass(hass)
   * Met à jour la référence hass pour tous les jobs actifs.
   */
  function update_hass(hass) {
    _hass = hass;
  }

  // Pause auto sur visibilitychange (reprend immédiatement quand visible)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Relancer les ticks en attente
      for (const domain of Object.keys(_jobs)) {
        const job = _jobs[domain];
        if (job && !job.running && !job.timer) {
          _tick(domain);
        }
      }
    }
  });

  window.hse_live_service = { start, stop, refresh, update_hass };
  console.info('[HSE] live.service.js ready');
})();
