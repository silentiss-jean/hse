(function () {
  async function fetch_scan(hass, options) {
    const include_disabled = options?.include_disabled ? "true" : "false";
    const exclude_hse = options?.exclude_hse === false ? "false" : "true";
    const path = `hse/unified/entities/scan?include_disabled=${include_disabled}&exclude_hse=${exclude_hse}`;
    return hass.callApi("GET", path);
  }

  window.hse_scan_api = { fetch_scan };
})();
