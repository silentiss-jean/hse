/*
HSE_DOC: custom_components/hse/docs/panel_loader.md
HSE_MAINTENANCE: If you change loader exported functions or load semantics, update the doc above.

Ce fichier est intentionnellement conservé à l'identique de la phase 1D.
Il expose window.hse_loader.{ load_script_once, load_css_text }
et contient le fix macOS virtual desktop (polling toutes les 2s).
Ne pas le modifier sans mettre à jour la doc ci-dessus.
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
  // Cas 2 strategy:
  //   1. ppr.requestUpdate() — Lit re-renders partial-panel-resolver cleanly,
  //      recreating ha-panel-custom with connectedCallback properly fired.
  //   2. Poll conn.connected every 200ms (max 10s) — inject hass only once
  //      the WS connection is confirmed ready. A fixed timer is unreliable
  //      because HA reconnection can take anywhere from 200ms to 3-4s.
  let _fix_in_progress = false;

  function _get_panel_custom() {
    const haRoot = document.querySelector("home-assistant");
    const haMain = haRoot?.shadowRoot?.querySelector("home-assistant-main")?.shadowRoot;
    const ppr    = haMain?.querySelector("partial-panel-resolver");
    return {
      pc:        haMain?.querySelector("ha-panel-custom"),
      ppr,
      freshHass: haRoot?.hass,
      haRoot,
    };
  }

  function _wait_connected_then_inject(attemptsLeft) {
    const { pc, freshHass: fh } = _get_panel_custom();
    const conn = fh?.connection;

    if (pc && fh && conn && conn.connected === true) {
      console.info("[HSE-LOADER] conn.connected=true — inject hass sur ha-panel-custom");
      pc.hass = fh;
      setTimeout(() => { _fix_in_progress = false; }, 1000);
      return;
    }

    if (attemptsLeft <= 0) {
      console.warn("[HSE-LOADER] timeout conn.connected (10s) — abandon fix");
      _fix_in_progress = false;
      return;
    }

    setTimeout(() => _wait_connected_then_inject(attemptsLeft - 1), 200);
  }

  function _check_panel_health() {
    if (!window.location.pathname.startsWith("/hse")) return;
    if (_fix_in_progress) return;

    const { pc: panel, ppr, freshHass, haRoot } = _get_panel_custom();

    if (!panel || !freshHass) return;

    if (!panel.hass) {
      console.warn("[HSE-LOADER] hass manquant — re-injection directe");
      panel.hass = freshHass;
      return;
    }

    if (!panel.shadowRoot) {
      console.warn("[HSE-LOADER] shadowRoot null — requestUpdate sur partial-panel-resolver");
      _fix_in_progress = true;

      if (ppr && typeof ppr.requestUpdate === "function") {
        ppr.requestUpdate();
        setTimeout(() => _wait_connected_then_inject(50), 100);
      } else {
        console.warn("[HSE-LOADER] ppr introuvable — fallback haRoot.requestUpdate");
        if (haRoot && typeof haRoot.requestUpdate === "function") {
          haRoot.requestUpdate();
        }
        setTimeout(() => _wait_connected_then_inject(50), 300);
      }
    }
  }

  setInterval(_check_panel_health, 2000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") _check_panel_health();
  });

  window.hse_loader = { load_script_once, load_css_text };
})();
