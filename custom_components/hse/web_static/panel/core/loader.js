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
  // Navigation must use HA's internal 'location-changed' event — pushState alone
  // is not enough for HA's Lit router to recreate ha-panel-custom.
  // After navigation, we force pc.hass = null then pc.hass = fresh to ensure
  // HsePanel.set hass() is called and propagates hass to all sub-modules
  // (hse_overview_state.update_hass, etc.) — without this, hass_raw stays null
  // inside the new HsePanel instance and the overview tick fails immediately.
  let _fix_in_progress = false;

  function _ha_navigate(path) {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { bubbles: true }));
  }

  function _get_panel_custom() {
    const haRoot = document.querySelector("home-assistant");
    const haMain = haRoot?.shadowRoot?.querySelector("home-assistant-main")?.shadowRoot;
    return { pc: haMain?.querySelector("ha-panel-custom"), freshHass: haRoot?.hass };
  }

  function _check_panel_health() {
    if (!window.location.pathname.startsWith("/hse")) return;
    if (_fix_in_progress) return;

    const { pc: panel, freshHass } = _get_panel_custom();

    if (!panel || !freshHass) return;

    // Cas 1 : hass manquant
    if (!panel.hass) {
      console.warn("[HSE-LOADER] hass manquant — re-injection");
      panel.hass = freshHass;
      return;
    }

    // Cas 2 : shadowRoot null (zombie — typique macOS bureaux virtuels)
    if (!panel.shadowRoot) {
      console.warn("[HSE-LOADER] shadowRoot null — forçage navigate via location-changed");
      _fix_in_progress = true;
      const path = window.location.pathname;
      _ha_navigate("/");
      setTimeout(() => {
        _ha_navigate(path);
        // Après la navigation, forcer hass = null puis hass = fresh sur
        // ha-panel-custom pour déclencher HsePanel.set hass() et propager
        // hass à hse_overview_state et aux autres modules.
        setTimeout(() => {
          const { pc, freshHass: fh } = _get_panel_custom();
          if (pc && fh) {
            console.info("[HSE-LOADER] re-inject hass sur ha-panel-custom après navigate");
            pc.hass = null;
            setTimeout(() => {
              const { freshHass: fh2 } = _get_panel_custom();
              if (pc && fh2) pc.hass = fh2;
            }, 100);
          }
          setTimeout(() => { _fix_in_progress = false; }, 3000);
        }, 800);
      }, 500);
    }
  }

  setInterval(_check_panel_health, 2000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _check_panel_health();
  });
  // -----------------------------------------------------------------------

  window.hse_loader = { load_script_once, load_css_text };
})();
