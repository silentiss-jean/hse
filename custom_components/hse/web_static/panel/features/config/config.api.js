/*
HSE_DOC: custom_components/hse/docs/config_ui.md
HSE_MAINTENANCE: If you change endpoints here, update config_api.md.
*/

(function () {
  async function fetch_catalogue(hass) {
    return window.hse_fetch(hass, 'GET', 'hse/unified/catalogue');
  }

  async function refresh_catalogue(hass) {
    return window.hse_fetch(hass, 'POST', 'hse/unified/catalogue/refresh', {});
  }

  async function set_reference_total(hass, entity_id) {
    return window.hse_fetch(hass, 'POST', 'hse/unified/catalogue/reference_total', {
      entity_id: entity_id ?? null,
    });
  }

  async function get_reference_total_status(hass, entity_id) {
    const suffix = entity_id ? `?entity_id=${encodeURIComponent(entity_id)}` : '';
    return window.hse_fetch(hass, 'GET', `hse/unified/catalogue/reference_total/status${suffix}`);
  }

  async function fetch_pricing(hass) {
    return window.hse_fetch(hass, 'GET', 'hse/unified/settings/pricing');
  }

  async function set_pricing(hass, pricing) {
    return window.hse_fetch(hass, 'POST', 'hse/unified/settings/pricing', { pricing });
  }

  async function clear_pricing(hass) {
    return window.hse_fetch(hass, 'POST', 'hse/unified/settings/pricing', { clear: true });
  }

  window.hse_config_api = {
    fetch_catalogue,
    refresh_catalogue,
    set_reference_total,
    get_reference_total_status,
    fetch_pricing,
    set_pricing,
    clear_pricing,
  };
})();
