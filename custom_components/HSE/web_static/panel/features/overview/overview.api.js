(function () {
  async function fetch_overview(hass) {
    const started_at = Date.now();

    try {
      const dashboard = await hass.callApi("GET", "hse/unified/dashboard");
      return {
        fetched_at: new Date().toISOString(),
        fetch_ms: Date.now() - started_at,
        dashboard,
      };
    } catch (err) {
      const details = {
        message: err?.message || String(err),
        status: err?.status,
        body: err?.body,
      };

      let extra = null;
      try {
        extra = JSON.stringify(details, null, 2);
      } catch (_) {
        extra = String(details.message);
      }

      return {
        fetched_at: new Date().toISOString(),
        fetch_ms: Date.now() - started_at,
        error: `dashboard_fetch_failed\n${extra}`,
      };
    }
  }

  // Backward-compatible name used by hse_panel.js (overview refresh button)
  async function fetch_manifest_and_ping(hass) {
    return fetch_overview(hass);
  }

  window.hse_overview_api = { fetch_overview, fetch_manifest_and_ping };
})();
