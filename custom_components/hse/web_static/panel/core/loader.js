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
  // Instead: inject hass directly on the existing element even when
  // shadowRoot = null. ha-panel-custom delegates hass to hse-panel via its
  // own internal mechanism, independently of shadowRoot state.
  let _fix_in_progress = false;

  function _get_panel_custom() {
    const haRoot = document.querySelector("home-assistant");
    const haMain = haRoot?.shadowRoot?.querySelector("home-assistant-main")?.shadowRoot;
    return { pc: haMain?.querySelector("ha-panel-custom"), freshHass: haRoot?.hass, haRoot };
  }

  function _check_panel_health() {
    if (!window.location.pathname.startsWith("/hse")) return;
    if (_fix_in_progress) return;

    const { pc: panel, freshHass, haRoot } = _get_panel_custom();

    if (!panel || !freshHass) return;

    // Cas 1 : hass manquant
    if (!panel.hass) {
      console.warn("[HSE-LOADER] hass manquant — re-injection");
      panel.hass = freshHass;
      return;
    }

    // Cas 2 : shadowRoot null (zombie — typique macOS bureaux virtuels)
    // Ne JAMAIS naviguer (location-changed détruit l'arbre Lit).
    // Injecter hass directement sur l'élément existant : ha-panel-custom
    // délègue hass à hse-panel via son mécanisme interne, indépendant du shadowRoot.
    if (!panel.shadowRoot) {
      console.warn("[HSE-LOADER] shadowRoot null — re-injection hass directe sans navigate");
      _fix_in_progress = true;

      // Tentative 1 : re-inject hass sur ha-panel-custom
      panel.hass = null;
      setTimeout(() => {
        const { pc, freshHass: fh, haRoot: ha } = _get_panel_custom();
        if (pc && fh) {
          console.info("[HSE-LOADER] tentative 1 : pc.hass = fresh");
          pc.hass = fh;
        }

        // Tentative 2 (fallback) : forcer HA à re-propager depuis la racine
        setTimeout(() => {
          const { pc: pc2, freshHass: fh2, haRoot: ha2 } = _get_panel_custom();
          if (pc2 && !pc2.shadowRoot && ha2 && fh2) {
            console.warn("[HSE-LOADER] tentative 2 (fallback) : home-assistant.hass = null → fresh");
            ha2.hass = null;
            setTimeout(() => {
              const { freshHass: fh3 } = _get_panel_custom();
              if (ha2 && fh3) ha2.hass = fh3;
            }, 100);
          }
          setTimeout(() => { _fix_in_progress = false; }, 3000);
        }, 500);
      }, 50);
    }
  }

  setInterval(_check_panel_health, 2000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _check_panel_health();
  });
  // -----------------------------------------------------------------------

  window.hse_loader = { load_script_once, load_css_text };
})();
