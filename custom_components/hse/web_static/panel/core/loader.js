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
  //
  // IMPORTANT: Never use location-changed navigate to recover the panel.
  // navigate destroys the Lit tree — new elements are inserted without
  // connectedCallback ever firing, leaving ha-panel-custom and
  // partial-panel-resolver as permanent zombies (_$litElement$: undefined,
  // renderRoot pointing to the element itself instead of its shadowRoot).
  //
  // When shadowRoot = null, injecting hass on ha-panel-custom is a no-op:
  // hse-panel no longer exists inside it. The correct fix is to call
  // requestUpdate() on partial-panel-resolver so Lit re-renders it cleanly,
  // recreating ha-panel-custom with connectedCallback properly fired.
  // After re-render, re-inject hass on the fresh ha-panel-custom instance.
  let _fix_in_progress = false;

  function _get_panel_custom() {
    const haRoot = document.querySelector("home-assistant");
    const haMain = haRoot?.shadowRoot?.querySelector("home-assistant-main")?.shadowRoot;
    const ppr    = haMain?.querySelector("partial-panel-resolver");
    return {
      pc:         haMain?.querySelector("ha-panel-custom"),
      ppr,
      freshHass:  haRoot?.hass,
      haRoot,
    };
  }

  function _check_panel_health() {
    if (!window.location.pathname.startsWith("/hse")) return;
    if (_fix_in_progress) return;

    const { pc: panel, ppr, freshHass, haRoot } = _get_panel_custom();

    if (!panel || !freshHass) return;

    // Cas 1 : hass manquant sur ha-panel-custom (panel vivant mais hass non propagé)
    if (!panel.hass) {
      console.warn("[HSE-LOADER] hass manquant — re-injection directe");
      panel.hass = freshHass;
      return;
    }

    // Cas 2 : shadowRoot null (zombie Lit — typique macOS bureaux virtuels)
    // Stratégie : requestUpdate() sur partial-panel-resolver pour forcer Lit
    // à re-rendre proprement sans navigate. ha-panel-custom sera recréé avec
    // connectedCallback appelé, puis on re-injecte hass sur la nouvelle instance.
    if (!panel.shadowRoot) {
      console.warn("[HSE-LOADER] shadowRoot null — requestUpdate sur partial-panel-resolver");
      _fix_in_progress = true;

      if (ppr && typeof ppr.requestUpdate === "function") {
        // Lit re-rend partial-panel-resolver → recrée ha-panel-custom proprement
        ppr.requestUpdate();
        setTimeout(() => {
          const { pc: newPc, freshHass: fh } = _get_panel_custom();
          if (newPc && fh) {
            console.info("[HSE-LOADER] re-inject hass sur nouveau ha-panel-custom après ppr.requestUpdate");
            newPc.hass = fh;
          } else if (haRoot && typeof haRoot.requestUpdate === "function") {
            // Fallback intermédiaire : remonter à home-assistant
            console.warn("[HSE-LOADER] fallback : haRoot.requestUpdate");
            haRoot.requestUpdate();
          }
          setTimeout(() => { _fix_in_progress = false; }, 3000);
        }, 500);
      } else {
        // Fallback : partial-panel-resolver inaccessible, forcer depuis la racine
        console.warn("[HSE-LOADER] ppr introuvable — fallback haRoot.requestUpdate");
        if (haRoot && typeof haRoot.requestUpdate === "function") {
          haRoot.requestUpdate();
        }
        setTimeout(() => {
          const { pc: newPc, freshHass: fh } = _get_panel_custom();
          if (newPc && fh) {
            console.info("[HSE-LOADER] re-inject hass après haRoot.requestUpdate");
            newPc.hass = fh;
          }
          setTimeout(() => { _fix_in_progress = false; }, 3000);
        }, 800);
      }
    }
  }

  setInterval(_check_panel_health, 2000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _check_panel_health();
  });
  // -----------------------------------------------------------------------

  window.hse_loader = { load_script_once, load_css_text };
})();
