(function () {
  async function fetch_catalogue(hass) {
    return window.hse_fetch(hass, 'GET', 'hse/unified/catalogue');
  }

  async function refresh_catalogue(hass) {
    return window.hse_fetch(hass, 'POST', 'hse/unified/catalogue/refresh', {});
  }

  async function set_item_triage(hass, item_id, triage) {
    const path = `hse/unified/catalogue/item/${encodeURIComponent(item_id)}/triage`;
    return window.hse_fetch(hass, 'POST', path, { triage });
  }

  async function bulk_triage(hass, item_ids, triage) {
    return window.hse_fetch(hass, 'POST', 'hse/unified/catalogue/triage/bulk', { item_ids, triage });
  }

  window.hse_diag_api = { fetch_catalogue, refresh_catalogue, set_item_triage, bulk_triage };
})();
