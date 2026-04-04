/* live.service.js — Phase 1B | global: window.hse_live_service
   Service de polling léger par domaine.
   Dépend de : window.hse_live_store

   Contrat méthodes :
     start(domain, fn_fetch_async, interval_ms)
     stop(domain)
     refresh(domain)
     update_hass(hass)

   Règles internes :
   - Pause auto si document.hidden
   - Ne jamais appeler fn_fetch si hass null ou conn.connected === false
   - Stocker résultats via window.hse_live_store.set(domain, 'data', result)

   Planning de polling :
     overview    : 30 000 ms, déclenché au premier accès onglet overview
     config_ref  : 4 000 ms,  onglet config actif
     costs       : MANUEL uniquement
     compare     : MANUEL uniquement
     diag        : MANUEL uniquement
     scan        : MANUEL uniquement
*/
(function () {
  "use strict";
  if (window.hse_live_service) return;

  // _jobs[domain] = { fn_fetch, interval_ms, timer, running }
  const _jobs = {};
  let _hass = null;

  // ------------------------------------------------------------------ helpers

  /** Vrai si hass est prêt et la connexion active */
  function _can_fetch() {
    if (!_hass) return false;
    const conn = _hass.connection;
    // conn absent (HA < 2023) => on considère OK
    if (!conn) return true;
    return conn.connected !== false;
  }

  /** Planifie le prochain tick après interval_ms */
  function _schedule(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    job.timer = setTimeout(() => _tick(domain), job.interval_ms);
  }

  // ------------------------------------------------------------------ tick

  async function _tick(domain) {
    const job = _jobs[domain];
    if (!job || job.running) return;
    job.timer = null;

    // Pause si fenêtre cachée
    if (document.hidden) {
      job.timer = setTimeout(() => _tick(domain), 2000);
      return;
    }

    // Pause si hass absent ou déconnecté
    if (!_can_fetch()) {
      job.timer = setTimeout(() => _tick(domain), 2000);
      return;
    }

    job.running = true;
    window.hse_live_store?.set(domain, "loading", true);
    try {
      const result = await job.fn_fetch(_hass);
      window.hse_live_store?.set(domain, "data", result);
      window.hse_live_store?.set(domain, "error", null);
    } catch (err) {
      const msg = err?.message || String(err);
      console.error(`[hse_live_service] ${domain} fetch error:`, msg);
      window.hse_live_store?.set(domain, "error", msg);
    } finally {
      window.hse_live_store?.set(domain, "loading", false);
      job.running = false;
      // Replanifier si le job n'a pas été stoppé entre-temps
      if (_jobs[domain]) _schedule(domain);
    }
  }

  // ------------------------------------------------------------------ API publique

  /**
   * start(domain, fn_fetch_async, interval_ms)
   * Lance le polling pour un domaine. Idempotent (appel double ignoré).
   * Déclenche un premier tick immédiatement.
   */
  function start(domain, fn_fetch, interval_ms) {
    if (_jobs[domain]) return; // Déjà actif
    _jobs[domain] = { fn_fetch, interval_ms, timer: null, running: false };
    // Marquer loading dès le démarrage
    window.hse_live_store?.set(domain, "loading", true);
    _tick(domain);
  }

  /**
   * stop(domain)
   * Arrête le polling et supprime le job.
   */
  function stop(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    delete _jobs[domain];
  }

  /**
   * refresh(domain)
   * Force un fetch immédiat (annule le timer en cours).
   * Usage : bouton "Rafraîchir" dans l'UI.
   */
  function refresh(domain) {
    const job = _jobs[domain];
    if (!job) return;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    window.hse_live_store?.set(domain, "loading", true);
    _tick(domain);
  }

  /**
   * update_hass(hass)
   * Met à jour la référence hass. Appelé par hse_panel lors de chaque
   * changement de set hass() ou de _switch_tab().
   * Si la connexion était en pause, les jobs en attente repartent.
   */
  function update_hass(hass) {
    const was_ready = _can_fetch();
    _hass = hass;
    // Si on passe de non-prêt à prêt, réveiller les jobs en pause
    if (!was_ready && _can_fetch()) {
      for (const domain of Object.keys(_jobs)) {
        const job = _jobs[domain];
        if (job && !job.running && !job.timer) {
          _tick(domain);
        }
      }
    }
  }

  // ------------------------------------------------------------------ visibilitychange

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Revenu au premier plan : relancer les jobs en attente
    for (const domain of Object.keys(_jobs)) {
      const job = _jobs[domain];
      if (job && !job.running && !job.timer && _can_fetch()) {
        _tick(domain);
      }
    }
  });

  // ------------------------------------------------------------------ export

  window.hse_live_service = { start, stop, refresh, update_hass };
  console.info("[HSE] hse_live_service ready");
})();
