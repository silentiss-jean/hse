(function () {
  // fetch_overview — utilise hse_fetch (HTTP pur) au lieu de hass.callApi (WS).
  // Ne throw JAMAIS : retourne toujours { fetched_at, fetch_ms, dashboard? | error? }
  async function fetch_overview(hass) {
    const started_at = Date.now();
    let dashboard = null;
    let err_details = null;

    try {
      dashboard = await window.hse_fetch(hass, 'GET', 'hse/unified/dashboard');
    } catch (err) {
      try {
        err_details = {
          message: err?.message || String(err),
          status:  err?.status,
          body:    err?.body,
          code:    err?.code,
        };
      } catch (_) {
        err_details = { message: String(err) };
      }
    }

    const fetch_ms = Date.now() - started_at;
    const fetched_at = new Date().toISOString();

    if (err_details) {
      let extra;
      try { extra = JSON.stringify(err_details, null, 2); } catch (_) { extra = String(err_details.message); }
      return { fetched_at, fetch_ms, error: `dashboard_fetch_failed\n${extra}` };
    }

    return { fetched_at, fetch_ms, dashboard };
  }

  async function fetch_manifest_and_ping(hass) {
    return fetch_overview(hass);
  }

  window.hse_overview_api = { fetch_overview, fetch_manifest_and_ping };
})();
