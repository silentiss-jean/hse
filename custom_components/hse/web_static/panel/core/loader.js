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
  // macOS Mission Control (3-finger swipe) triggers NO browser event at all.
  // visibilitychange and window.focus are both unreliable in this context.
  // Polling every 2s is the only reliable detection mechanism.
  let _fix_in_progress = false;

  function _check_panel_health() {
    // Seulement si on est sur /hse
    if (!window.location.pathname.startsWith("/hse")) return;
    // Ne pas lancer deux corrections en parallèle
    if (_fix_in_progress) return;

    const haRoot    = document.querySelector("home-assistant");
    const haMain    = haRoot?.shadowRoot
                        ?.querySelector("home-assistant-main")?.shadowRoot;
    const panel     = haMain?.querySelector("ha-panel-custom");
    const freshHass = haRoot?.hass;

    if (!panel || !freshHass) return;

    // Cas 1 : hass manquant
    if (!panel.hass) {
      console.warn("[HSE-LOADER] hass manquant — re-injection");
      panel.hass = freshHass;
      return;
    }

    // Cas 2 : shadowRoot null (zombie — typique macOS bureaux virtuels)
    if (!panel.shadowRoot) {
      console.warn("[HSE-LOADER] shadowRoot null — forçage navigate");
      _fix_in_progress = true;
      const path = window.location.pathname;
      window.history.pushState({}, "", "/");
      setTimeout(() => {
        window.history.pushState({}, "", path);
        // Laisser 3s à HA pour remonter le panel avant de re-checker
        setTimeout(() => { _fix_in_progress = false; }, 3000);
      }, 150);
    }
  }

  setInterval(_check_panel_health, 2000);

  // Garder les event listeners en bonus pour les cas onglets Chrome
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _check_panel_health();
  });
  // -----------------------------------------------------------------------

  window.hse_loader = { load_script_once, load_css_text };
})();
