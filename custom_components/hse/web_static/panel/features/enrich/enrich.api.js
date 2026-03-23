/* enrich.api.js */
(function () {
  // hass.callApi() prefixes the path with /api.
  // So here we must NOT start with /api, otherwise we end up calling /api//api/...
  const BASE = "hse/unified/enrich";

  async function preview(hass, payload) {
    return hass.callApi("post", `${BASE}/preview`, payload || {});
  }

  async function apply(hass, payload) {
    return hass.callApi("post", `${BASE}/apply`, payload || {});
  }

  window.hse_enrich_api = { preview, apply };
})();
