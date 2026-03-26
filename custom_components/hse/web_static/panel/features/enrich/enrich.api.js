/* enrich.api.js */
(function () {
  const BASE = 'hse/unified/enrich';

  async function preview(hass, payload) {
    return window.hse_fetch(hass, 'POST', `${BASE}/preview`, payload || {});
  }

  async function apply(hass, payload) {
    return window.hse_fetch(hass, 'POST', `${BASE}/apply`, payload || {});
  }

  window.hse_enrich_api = { preview, apply };
})();
