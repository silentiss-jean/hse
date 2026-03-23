/* entrypoint - hse_panel.js */
const build_signature = "2026-02-19_1720_modular";

(function () {
  class hse_panel extends HTMLElement {
    constructor() {
      super();
      this._hass = null;
      this._root = null;

      this._ui = null;
      this._active_tab = "overview";

      this._overview_data = null;
      this._scan_result = { integrations: [], candidates: [] };

      this._scan_state = { scan_running: false, filter_q: "" };
    }

    set hass(hass) {
      this._hass = hass;
      this._render();
    }

    connectedCallback() {
      if (this._root) return;

      console.info(`[HSE] entry loaded (${build_signature})`);
      window.__hse_panel_loaded = build_signature;

      this._root = this.attachShadow({ mode: "open" });

      // charge tokens css
      this._boot();
    }

    async _boot() {
      const base = "/api/home_suivi_elec/static/panel";
      const { load_script_once, load_css_text } = window.hse_loader || {};

      // loader + dom doivent être disponibles même si ça charge dans le désordre
      if (!window.hse_loader) {
        // loader minimal inline fallback
        window.hse_loader = {
          load_script_once: (url) =>
            new Promise((resolve, reject) => {
              const s = document.createElement("script");
              s.src = url;
              s.onload = resolve;
              s.onerror = () => reject(new Error(`script_load_failed: ${url}`));
              document.head.appendChild(s);
            }),
          load_css_text: async (url) => {
            const resp = await fetch(url, { cache: "no-store" });
            if (!resp.ok) throw new Error(`css_load_failed: ${url}`);
            return resp.text();
          },
        };
      }

      // core libs
      await window.hse_loader.load_script_once(`${base}/shared/ui/dom.js?v=0.1.0`);
      await window.hse_loader.load_script_once(`${base}/shared/ui/table.js?v=0.1.0`);
      await window.hse_loader.load_script_once(`${base}/core/shell.js?v=0.1.0`);

      // features
      await window.hse_loader.load_script_once(`${base}/features/overview/overview.api.js?v=0.1.0`);
      await window.hse_loader.load_script_once(`${base}/features/overview/overview.view.js?v=0.1.0`);
      await window.hse_loader.load_script_once(`${base}/features/scan/scan.api.js?v=0.1.0`);
      await window.hse_loader.load_script_once(`${base}/features/scan/scan.view.js?v=0.1.0`);

      // css
      const css = await window.hse_loader.load_css_text(`${base}/shared/styles/tokens.css?v=0.1.0`);
      this._root.innerHTML = `<style>${css}</style><div id="root"></div>`;
      this._render();
    }

    _render() {
      if (!this._root) return;
      const root = this._root.querySelector("#root");
      if (!root) return;
      if (!window.hse_shell || !window.hse_dom) return;

      const user_name = this._hass?.user?.name || "—";
      if (!this._ui) {
        this._ui = window.hse_shell.create_shell(root, { user_name });
      }

      this._ui.header_right.textContent = `user: ${user_name}`;
      window.hse_shell.render_tabs(this._ui.tabs, this._active_tab, (tab_id) => {
        this._active_tab = tab_id;
        this._render();
      });

      window.hse_dom.clear(this._ui.content);

      if (!this._hass) {
        this._ui.content.appendChild(window.hse_dom.el("div", "hse_card", "En attente de hass…"));
        return;
      }

      if (this._active_tab === "overview") {
        this._render_overview();
        return;
      }

      if (this._active_tab === "scan") {
        this._render_scan();
        return;
      }
    }

    async _render_overview() {
      const container = this._ui.content;

      const card = window.hse_dom.el("div", "hse_card");
      const toolbar = window.hse_dom.el("div", "hse_toolbar");

      const btn = window.hse_dom.el("button", "hse_button hse_button_primary", "Rafraîchir");
      btn.addEventListener("click", async () => {
        this._overview_data = null;
        this._render();

        try {
          this._overview_data = await window.hse_overview_api.fetch_manifest_and_ping(this._hass);
        } catch (err) {
          this._overview_data = { error: err?.message || String(err) };
        }
        this._render();
      });

      toolbar.appendChild(btn);
      card.appendChild(toolbar);
      container.appendChild(card);

      if (!this._overview_data) {
        container.appendChild(window.hse_dom.el("div", "hse_subtitle", "Clique sur Rafraîchir."));
        return;
      }

      window.hse_overview_view.render_overview(container, this._overview_data);
    }

    _render_scan() {
      const container = this._ui.content;

      window.hse_scan_view.render_scan(
        container,
        this._scan_result,
        this._scan_state,
        async (action, value) => {
          if (action === "filter") {
            this._scan_state.filter_q = value || "";
            this._render();
            return;
          }

          if (action === "scan") {
            this._scan_state.scan_running = true;
            this._render();

            try {
              this._scan_result = await window.hse_scan_api.fetch_scan(this._hass, {
                include_disabled: false,
                exclude_hse: true,
              });
            } catch (err) {
              this._scan_result = { error: err?.message || String(err), integrations: [], candidates: [] };
            } finally {
              this._scan_state.scan_running = false;
              this._render();
            }
          }
        }
      );
    }
  }

  customElements.define("hse-panel", hse_panel);
})();
