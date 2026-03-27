/*
HSE_DOC: custom_components/hse/docs/panel_loader.md
HSE_MAINTENANCE: If you change loader exported functions or load semantics, update the doc above.
*/

(function () {
  const loaded_urls = new Set();

  function load_script_once(url) {
    if (loaded_urls.has(url)) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = () => {
        loaded_urls.add(url);
        resolve();
      };
      script.onerror = () => reject(new Error(`script_load_failed: ${url}`));
      document.head.appendChild(script);
    });
  }

  async function load_css_text(url) {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`css_load_failed: ${url} (${resp.status})`);
    return resp.text();
  }

  // --- Fix: recover ha-panel-custom after macOS virtual desktop switch ---
  // Mission Control (3-finger swipe) does not trigger visibilitychange,
  // so we use window 'focus' as primary trigger + visibilitychange as backup.
  function _fix_panel_on_focus() {
    setTimeout(() => {
      const haRoot    = document.querySelector("home-assistant");
      const haMain    = haRoot?.shadowRoot
                          ?.querySelector("home-assistant-main")?.shadowRoot;
      const panel     = haMain?.querySelector("ha-panel-custom");
      const freshHass = haRoot?.hass;

      if (!panel || !freshHass) return;

      // Cas 1 : hass manquant sur ha-panel-custom
      if (!panel.hass) {
        console.warn("[HSE-LOADER] hass manquant — re-injection");
        panel.hass = freshHass;
        return;
      }

      // Cas 2 : hass OK mais shadowRoot null (élément zombie — typique macOS bureaux virtuels)
      if (!panel.shadowRoot) {
        console.warn("[HSE-LOADER] shadowRoot null — forçage navigate");
        const path = window.location.pathname;
        window.history.pushState({}, "", "/");
        setTimeout(() => window.history.pushState({}, "", path), 100);
      }
    }, 600);
  }

  window.addEventListener("focus", _fix_panel_on_focus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _fix_panel_on_focus();
  });
  // -----------------------------------------------------------------------

  window.hse_loader = { load_script_once, load_css_text };
})();
