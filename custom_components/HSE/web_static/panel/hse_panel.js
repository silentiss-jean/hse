/* entrypoint - hse_panel.js */
const build_signature = "2026-03-10_0711_costs_noflicker_badges_synthesis";

(function () {
  const PANEL_BASE = "/api/hse/static/panel";
  const SHARED_BASE = "/api/hse/static/shared";

  // IMPORTANT: must match const.py PANEL_JS_URL
  const ASSET_V = "0.1.32";

  const NAV_ITEMS_FALLBACK = [
    { id: "overview", label: "Accueil" },
    { id: "diagnostic", label: "Diagnostic" },
    { id: "scan", label: "Détection" },
    { id: "config", label: "Configuration" },
    { id: "custom", label: "Customisation" },
    { id: "cards", label: "Génération cartes" },
    { id: "migration", label: "Migration capteurs" },
    { id: "costs", label: "Analyse de coûts" },
  ];

  class hse_panel extends HTMLElement {
    constructor() {
      super();

      this._hass = null;
      this._root = null;
      this._ui = null;

      this._active_tab = "overview";
      this._overview_data = null;
      this._overview_timer = null;
      this._overview_refreshing = false;

      this._scan_result = { integrations: [], candidates: [] };
      this._scan_state = {
        scan_running: false,
        filter_q: "",
        groups_open: {},
        open_all: false,
      };

      this._diag_state = {
        loading: false,
        data: null,
        error: null,
        filter_q: "",
        selected: {},
        advanced: false,
        last_request: null,
        last_response: null,
        last_action: null,
        check_loading: false,
        check_error: null,
        check_result: null,
      };

      this._migration_state = {
        loading: false,
        error: null,
        last: null,
        active_yaml: "",
      };

      this._config_state = {
        loading: false,
        saving: false,
        error: null,
        message: null,
        pricing_saving: false,
        pricing_error: null,
        pricing_message: null,
        scan_result: { integrations: [], candidates: [] },
        catalogue: null,
        current_reference_entity_id: null,
        selected_reference_entity_id: null,
        reference_status: null,
        reference_status_error: null,
        pricing: null,
        pricing_defaults: null,
        pricing_draft: null,
        cost_filter_q: "",
      };

      this._boot_done = false;
      this._boot_error = null;

      // Default: follow Home Assistant theme
      this._theme = "ha";
      this._custom_state = {
        theme: "ha",
        dynamic_bg: true,
        glass: false,
      };

      this._org_state = {
        loading: false,
        saving: false,
        dirty: false,
        error: null,
        message: null,
        meta_store: null,
        meta_draft: null,
        preview_running: false,
        apply_running: false,
        show_raw: false,
        rooms_filter_q: "",
        assignments_filter_q: "",
      };

      this._render_raf_scheduled = false;
      this._reference_status_timer = null;
      this._reference_status_polling = false;
      this._reference_status_target_entity_id = undefined;
    }

    disconnectedCallback() {
      this._clear_overview_autorefresh();
      this._clear_reference_status_polling();
    }

    set hass(hass) {
      this._hass = hass;

      // IMPORTANT: avoid tearing down interactive UI controls on frequent hass updates.
      // Otherwise <select> and other inputs close/reset while the user interacts.
      if (this._active_tab === "custom") return;
      if (this._active_tab === "config") return;
      if (this._active_tab === "costs") return;

      this._render();
    }

    connectedCallback() {
      if (this._root) return;

      console.info(`[HSE] entry loaded (${build_signature})`);
      window.__hse_panel_loaded = build_signature;

      this._theme = this._storage_get("hse_theme") || "ha";
      this._custom_state.theme = this._theme;

      this._custom_state.dynamic_bg = (this._storage_get("hse_custom_dynamic_bg") || "1") === "1";
      this._custom_state.glass = (this._storage_get("hse_custom_glass") || "0") === "1";

      this.setAttribute("data-theme", this._theme);
      this._apply_dynamic_bg_override();
      this._apply_glass_override();

      const saved_tab = this._storage_get("hse_active_tab");
      if (saved_tab) this._active_tab = saved_tab;

      try {
        const raw = this._storage_get("hse_scan_groups_open");
        if (raw) this._scan_state.groups_open = JSON.parse(raw) || {};
      } catch (_) {}
      this._scan_state.open_all = (this._storage_get("hse_scan_open_all") || "0") === "1";

      this._diag_state.filter_q = this._storage_get("hse_diag_filter_q") || "";
      this._diag_state.advanced = (this._storage_get("hse_diag_advanced") || "0") === "1";
      try {
        const rawSel = this._storage_get("hse_diag_selected");
        if (rawSel) this._diag_state.selected = JSON.parse(rawSel) || {};
      } catch (_) {}

      this._config_state.cost_filter_q = this._storage_get("hse_config_cost_filter_q") || "";

      this._root = this.attachShadow({ mode: "open" });
      this._boot();
    }

    _storage_get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch (_) {
        return null;
      }
    }

    _storage_set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (_) {}
    }

    _err_msg(err) {
      if (!err) return "?";
      if (typeof err === "string") return err;
      if (err.message) return String(err.message);
      try {
        return JSON.stringify(err);
      } catch (_) {
        return String(err);
      }
    }

    _deep_fill_missing(dst, src) {
      if (!dst || typeof dst !== "object") return;
      if (!src || typeof src !== "object") return;

      for (const k of Object.keys(src)) {
        const v = src[k];
        const cur = dst[k];

        if (cur == null) {
          try {
            dst[k] = JSON.parse(JSON.stringify(v));
          } catch (_) {
            dst[k] = v;
          }
          continue;
        }

        if (
          typeof cur === "object" &&
          typeof v === "object" &&
          cur &&
          v &&
          !Array.isArray(cur) &&
          !Array.isArray(v)
        ) {
          this._deep_fill_missing(cur, v);
        }
      }
    }

    _deep_set(obj, path, v) {
      if (!obj || typeof obj !== "object") return;
      const parts = String(path || "").split(".").filter(Boolean);
      if (!parts.length) return;
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = v;
    }

    _render_ui_error(title, err) {
      try {
        console.error(`[HSE] UI error in ${title}`, err);
        if (!this._ui || !window.hse_dom) return;
        const { el, clear } = window.hse_dom;
        clear(this._ui.content);
        const card = el("div", "hse_card");
        card.appendChild(el("div", null, `Erreur UI: ${title}`));
        card.appendChild(el("pre", "hse_code", this._err_msg(err)));
        this._ui.content.appendChild(card);
      } catch (_) {}
    }

    _clear_overview_autorefresh() {
      if (this._overview_timer) {
        try {
          window.clearInterval(this._overview_timer);
        } catch (_) {}
      }
      this._overview_timer = null;
      this._overview_refreshing = false;
    }

    _reference_effective_entity_id() {
      return this._config_state.selected_reference_entity_id || this._config_state.current_reference_entity_id || null;
    }

    _clear_reference_status_polling() {
      if (this._reference_status_timer) {
        try {
          window.clearInterval(this._reference_status_timer);
        } catch (_) {}
      }
      this._reference_status_timer = null;
      this._reference_status_polling = false;
      this._reference_status_target_entity_id = undefined;
    }

    _ensure_reference_status_polling() {
      if (this._reference_status_timer) return;
      if (!this._hass || !window.hse_config_api?.get_reference_total_status) return;

      const tick = async () => {
        await this._fetch_reference_status();
      };

      this._reference_status_timer = window.setInterval(tick, 4000);
      tick();
    }

    async _fetch_reference_status(for_entity_id) {
      if (!this._hass || !window.hse_config_api?.get_reference_total_status) return null;

      const requested_entity_id = for_entity_id === undefined ? this._reference_effective_entity_id() : for_entity_id;
      this._reference_status_target_entity_id = requested_entity_id;

      if (this._reference_status_polling) return this._config_state.reference_status;

      this._reference_status_polling = true;
      try {
        while (true) {
          const entity_id = this._reference_status_target_entity_id;
          const resp = await window.hse_config_api.get_reference_total_status(this._hass, entity_id);

          if (this._reference_status_target_entity_id !== entity_id) {
            continue;
          }

          const effective_entity_id = this._reference_effective_entity_id();
          if (effective_entity_id !== entity_id) {
            this._reference_status_target_entity_id = effective_entity_id;
            continue;
          }

          this._config_state.reference_status = resp || null;
          this._config_state.reference_status_error = null;
          return resp || null;
        }
      } catch (err) {
        this._config_state.reference_status_error = this._err_msg(err);
        return null;
      } finally {
        this._reference_status_polling = false;
        if (this._active_tab === "config") this._render();
      }
    }

    _ensure_overview_autorefresh() {
      if (this._overview_timer) return;

      const tick = async () => {
        if (this._overview_refreshing) return;
        this._overview_refreshing = true;

        try {
          const fn = window.hse_overview_api?.fetch_overview || window.hse_overview_api?.fetch_manifest_and_ping;
          if (!fn) throw new Error("overview_api_not_loaded");
          this._overview_data = await fn(this._hass);
        } catch (err) {
          this._overview_data = { error: this._err_msg(err) };
        } finally {
          this._overview_refreshing = false;
          this._render();
        }
      };

      this._overview_timer = window.setInterval(tick, 30000);

      if (!this._overview_data) {
        tick();
      }
    }

    _org_ensure_draft() {
      if (this._org_state.meta_draft) return;

      const m = this._org_state.meta_store?.meta || null;
      if (m) {
        try {
          this._org_state.meta_draft = JSON.parse(JSON.stringify(m));
        } catch (_) {
          this._org_state.meta_draft = m;
        }
      } else {
        this._org_state.meta_draft = { rooms: {}, types: {}, assignments: {} };
      }

      if (!this._org_state.meta_draft.rooms) this._org_state.meta_draft.rooms = {};
      if (!this._org_state.meta_draft.types) this._org_state.meta_draft.types = {};
      if (!this._org_state.meta_draft.assignments) this._org_state.meta_draft.assignments = {};
    }

    _org_reset_draft_from_store() {
      const m = this._org_state.meta_store?.meta || null;
      if (!m) {
        this._org_state.meta_draft = { rooms: {}, types: {}, assignments: {} };
      } else {
        try {
          this._org_state.meta_draft = JSON.parse(JSON.stringify(m));
        } catch (_) {
          this._org_state.meta_draft = m;
        }
      }

      if (!this._org_state.meta_draft.rooms) this._org_state.meta_draft.rooms = {};
      if (!this._org_state.meta_draft.types) this._org_state.meta_draft.types = {};
      if (!this._org_state.meta_draft.assignments) this._org_state.meta_draft.assignments = {};

      this._org_state.dirty = false;
    }

    async _org_fetch_meta() {
      if (!this._hass) return;
      if (this._org_state.loading) return;

      this._org_state.loading = true;
      this._org_state.error = null;
      this._org_state.message = null;
      this._render();

      try {
        const resp = await this._hass.callApi("get", "hse/unified/meta");
        this._org_state.meta_store = resp?.meta_store || null;
        this._org_state.error = null;

        if (!this._org_state.dirty) {
          this._org_reset_draft_from_store();
        } else {
          this._org_ensure_draft();
        }
      } catch (err) {
        this._org_state.error = this._err_msg(err);
      } finally {
        this._org_state.loading = false;
        this._render();
      }
    }

    async _org_save_meta() {
      if (!this._hass) return;
      if (this._org_state.saving || this._org_state.loading || this._org_state.preview_running || this._org_state.apply_running) return;

      this._org_ensure_draft();

      const ok = window.confirm("Sauvegarder l'organisation (meta: rooms/types/assignments) ?");
      if (!ok) return;

      this._org_state.saving = true;
      this._org_state.error = null;
      this._org_state.message = "Sauvegarde…";
      this._render();

      try {
        const resp = await this._hass.callApi("post", "hse/unified/meta", {
          meta: this._org_state.meta_draft,
        });

        this._org_state.meta_store = resp?.meta_store || this._org_state.meta_store;
        this._org_state.message = "Organisation sauvegardée.";
        this._org_state.error = null;
        this._org_state.dirty = false;

        if (!this._org_state.dirty) {
          this._org_reset_draft_from_store();
        }
      } catch (err) {
        this._org_state.error = this._err_msg(err);
        this._org_state.message = "Échec de sauvegarde.";
      } finally {
        this._org_state.saving = false;
        this._render();
      }
    }

    async _org_preview() {
      if (!this._hass) return;
      if (this._org_state.preview_running || this._org_state.loading) return;

      this._org_state.preview_running = true;
      this._org_state.error = null;
      this._org_state.message = null;
      this._render();

      try {
        const resp = await this._hass.callApi("post", "hse/unified/meta/sync/preview", { persist: true });
        this._org_state.meta_store = resp?.meta_store || this._org_state.meta_store;
        this._org_state.error = null;
        this._org_state.message = "Propositions mises à jour.";

        if (!this._org_state.dirty) {
          this._org_reset_draft_from_store();
        } else {
          this._org_ensure_draft();
        }
      } catch (err) {
        this._org_state.error = this._err_msg(err);
      } finally {
        this._org_state.preview_running = false;
        this._render();
      }
    }

    async _org_apply(apply_mode) {
      if (!this._hass) return;
      if (this._org_state.apply_running || this._org_state.loading || this._org_state.preview_running) return;

      const mode = apply_mode === "all" ? "all" : "auto";

      const msg =
        mode === "all"
          ? "Appliquer les changements proposés (mode ALL) ?\nCe mode peut écraser des choix manuels."
          : "Appliquer les changements proposés (mode auto) ?\nAucun champ manuel ne sera écrasé.";

      const ok = window.confirm(msg);
      if (!ok) return;

      this._org_state.apply_running = true;
      this._org_state.error = null;
      this._org_state.message = null;
      this._render();

      try {
        const resp = await this._hass.callApi("post", "hse/unified/meta/sync/apply", { apply_mode: mode });
        this._org_state.meta_store = resp?.meta_store || this._org_state.meta_store;
        this._org_state.error = null;
        this._org_state.message = "Changements appliqués.";

        if (!this._org_state.dirty) {
          this._org_reset_draft_from_store();
        } else {
          this._org_ensure_draft();
        }
      } catch (err) {
        this._org_state.error = this._err_msg(err);
      } finally {
        this._org_state.apply_running = false;
        this._render();
      }
    }

    async _boot() {
      if (this._boot_done) return;

      if (!window.hse_loader) {
        window.hse_loader = {
          load_script_once: (url) =>
            new Promise((resolve, reject) => {
              const s = document.createElement("script");
              s.src = url;
              s.async = true;
              s.onload = resolve;
              s.onerror = () => reject(new Error(`script_load_failed: ${url}`));
              document.head.appendChild(s);
            }),
          load_css_text: async (url) => {
            const resp = await fetch(url, { cache: "no-store" });
            if (!resp.ok) throw new Error(`css_load_failed: ${url} (${resp.status})`);
            return resp.text();
          },
        };
      }

      try {
        await window.hse_loader.load_script_once(`${SHARED_BASE}/ui/dom.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${SHARED_BASE}/ui/table.js?v=${ASSET_V}`);

        await window.hse_loader.load_script_once(`${PANEL_BASE}/core/shell.js?v=${ASSET_V}`);

        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/overview/overview.api.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/overview/overview.view.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/costs/costs.view.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/scan/scan.api.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/scan/scan.view.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/custom/custom.view.js?v=${ASSET_V}`);

        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.api.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.view.js?v=${ASSET_V}`);

        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/enrich/enrich.api.js?v=${ASSET_V}`);

        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/migration/migration.api.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/migration/migration.view.js?v=${ASSET_V}`);

        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/config/config.api.js?v=${ASSET_V}`);
        await window.hse_loader.load_script_once(`${PANEL_BASE}/features/config/config.view.js?v=${ASSET_V}`);

        const css_tokens = await window.hse_loader.load_css_text(`${SHARED_BASE}/styles/hse_tokens.shadow.css?v=${ASSET_V}`);
        const css_themes = await window.hse_loader.load_css_text(`${SHARED_BASE}/styles/hse_themes.shadow.css?v=${ASSET_V}`);
        const css_alias = await window.hse_loader.load_css_text(`${SHARED_BASE}/styles/hse_alias.v2.css?v=${ASSET_V}`);
        const css_panel = await window.hse_loader.load_css_text(`${SHARED_BASE}/styles/tokens.css?v=${ASSET_V}`);

        this._root.innerHTML = `<style>\n${css_tokens}\n\n${css_themes}\n\n${css_alias}\n\n${css_panel}\n</style><div id=\"root\"></div>`;

        this._boot_done = true;
        this._boot_error = null;
      } catch (err) {
        this._boot_error = err?.message || String(err);
        console.error("[HSE] boot error", err);

        this._root.innerHTML = `<style>\n:host{display:block;padding:16px;font-family:system-ui;color:var(--primary-text-color);}\npre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.2);padding:12px;border-radius:10px;}\n</style>\n<div>\n  <div style=\"font-size:18px\">Home Suivi Elec</div>\n  <div style=\"opacity:.8\">Boot error</div>\n  <pre>${this._escape_html(this._boot_error)}</pre>\n</div>`;
      } finally {
        this._render();
      }
    }

    _escape_html(s) {
      return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    _get_nav_items() {
      const from_shell = window.hse_shell?.get_nav_items?.();
      const items = Array.isArray(from_shell) && from_shell.length ? from_shell : NAV_ITEMS_FALLBACK;
      return items.filter((x) => x && x.id !== "enrich");
    }

    _ensure_valid_tab() {
      const items = this._get_nav_items();
      if (!items.some((x) => x.id === this._active_tab)) {
        this._active_tab = items[0]?.id || "overview";
      }
    }

    _set_active_tab(tab_id) {
      this._active_tab = tab_id;
      this._storage_set("hse_active_tab", tab_id);
      this._render();
    }

    _set_theme(theme_key) {
      this._theme = theme_key || "ha";
      this._custom_state.theme = this._theme;

      this.setAttribute("data-theme", this._theme);
      this._storage_set("hse_theme", this._theme);
      this._render();
    }

    _apply_dynamic_bg_override() {
      this.style.setProperty("--hse-bg-dynamic-opacity", this._custom_state.dynamic_bg ? "" : "0");
    }

    _apply_glass_override() {
      this.style.setProperty("--hse-backdrop-filter", this._custom_state.glass ? "blur(18px) saturate(160%)" : "");
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

      this._ensure_valid_tab();
      this._render_nav_tabs();

      window.hse_dom.clear(this._ui.content);

      if (!this._hass) {
        this._ui.content.appendChild(window.hse_dom.el("div", "hse_card", "En attente de hass…"));
        return;
      }

      if (this._active_tab !== "overview" && this._active_tab !== "costs") {
        this._clear_overview_autorefresh();
      }
      if (this._active_tab !== "config") {
        this._clear_reference_status_polling();
      }

      try {
        switch (this._active_tab) {
          case "overview":
            this._render_overview().catch((err) => this._render_ui_error("Accueil", err));
            return;
          case "costs":
            this._render_costs().catch((err) => this._render_ui_error("Analyse de coûts", err));
            return;
          case "diagnostic":
            this._render_diagnostic().catch((err) => this._render_ui_error("Diagnostic", err));
            return;
          case "scan":
            this._render_scan();
            return;
          case "migration":
            this._render_migration().catch((err) => this._render_ui_error("Migration", err));
            return;
          case "config":
            this._render_config().catch((err) => this._render_ui_error("Configuration", err));
            return;
          case "custom":
            this._render_custom().catch((err) => this._render_ui_error("Customisation", err));
            return;
          default:
            this._render_placeholder("Page", "À venir.");
        }
      } catch (err) {
        this._render_ui_error("render", err);
      }
    }

    _render_nav_tabs() {
      const { el, clear } = window.hse_dom;
      clear(this._ui.tabs);

      for (const it of this._get_nav_items()) {
        const b = el("button", "hse_tab", it.label);
        b.dataset.active = it.id === this._active_tab ? "true" : "false";
        b.addEventListener("click", () => this._set_active_tab(it.id));
        this._ui.tabs.appendChild(b);
      }
    }

    _render_placeholder(title, subtitle) {
      const { el } = window.hse_dom;

      const card = el("div", "hse_card");
      card.appendChild(el("div", null, title));
      card.appendChild(el("div", "hse_subtitle", subtitle || "À venir."));
      this._ui.content.appendChild(card);
    }

    async _render_migration() {
      const container = this._ui.content;

      if (!window.hse_migration_view || !window.hse_migration_api) {
        this._render_placeholder("Migration", "migration.view.js non chargé.");
        return;
      }

      const run = async (opt) => {
        this._migration_state.loading = true;
        this._migration_state.error = null;
        this._render();

        try {
          const resp = await window.hse_migration_api.export_yaml(this._hass, { mode: "selection" });
          this._migration_state.last = resp;
          this._migration_state.active_yaml = resp?.exports?.[opt] || "";
        } catch (err) {
          this._migration_state.error = this._err_msg(err);
        } finally {
          this._migration_state.loading = false;
          this._render();
        }
      };

      window.hse_migration_view.render_migration(container, this._migration_state, async (action, payload) => {
        if (action === "export" || action === "preview") {
          const opt = payload?.option;
          await run(opt);
          return;
        }
      });
    }

    async _render_config() {
      const container = this._ui.content;

      if (!window.hse_config_view || !window.hse_config_api || !window.hse_scan_api) {
        this._render_placeholder("Configuration", "config.view.js non chargé.");
        return;
      }

      const _effective_ref = () => this._config_state.selected_reference_entity_id || this._config_state.current_reference_entity_id || null;

      const _ensure_pricing_draft = () => {
        if (!this._config_state.pricing_draft) {
          const base = JSON.parse(JSON.stringify(this._config_state.pricing_defaults || {}));
          const pr = JSON.parse(JSON.stringify(this._config_state.pricing || {}));
          this._deep_fill_missing(pr, base);
          this._config_state.pricing_draft = pr;
        } else {
          this._deep_fill_missing(this._config_state.pricing_draft, this._config_state.pricing_defaults || {});
        }
      };

      const _cost_ids = () => {
        _ensure_pricing_draft();
        const arr = this._config_state.pricing_draft?.cost_entity_ids;
        return Array.isArray(arr) ? arr : [];
      };

      const _remove_ref_from_cost = () => {
        const ref = _effective_ref();
        if (!ref) return false;
        const ids = _cost_ids();
        if (!ids.includes(ref)) return false;
        this._config_state.pricing_draft.cost_entity_ids = ids.filter((x) => x !== ref);
        return true;
      };

      const _update_from_catalogue = (cat) => {
        this._config_state.catalogue = cat;
        const cur = window.hse_config_view._current_reference_entity_id(cat);
        this._config_state.current_reference_entity_id = cur;
        if (this._config_state.selected_reference_entity_id == null) {
          this._config_state.selected_reference_entity_id = cur;
        }

        const snapshot = window.hse_config_view._reference_status_from_catalogue?.(
          cat,
          this._config_state.selected_reference_entity_id || cur || null
        );
        if (snapshot && typeof snapshot === "object") {
          this._config_state.reference_status = {
            ...(this._config_state.reference_status || {}),
            ...snapshot,
            entity_id: snapshot.entity_id || cur || this._config_state.selected_reference_entity_id || null,
          };
        }

        if (this._config_state.pricing_draft && _remove_ref_from_cost()) {
          this._config_state.pricing_message = "Garde-fou: le capteur de référence a été retiré des capteurs de calcul.";
        }
      };

      const _update_from_pricing = (resp) => {
        const pr = resp?.pricing || null;
        const defs = resp?.defaults || null;
        this._config_state.pricing = pr;
        this._config_state.pricing_defaults = defs;

        if (this._config_state.pricing_draft == null) {
          const base = JSON.parse(JSON.stringify(defs || {}));
          const cur = JSON.parse(JSON.stringify(pr || {}));
          this._deep_fill_missing(cur, base);
          this._config_state.pricing_draft = cur;
        } else {
          this._deep_fill_missing(this._config_state.pricing_draft, this._config_state.pricing_defaults || {});
        }

        if (_remove_ref_from_cost()) {
          this._config_state.pricing_message = "Garde-fou: le capteur de référence a été retiré des capteurs de calcul.";
        }
      };

      const _group_key_for_candidate = (c) => {
        if (!c || !c.device_id) return null;
        return `${c.device_id}|${c.kind || ""}|${c.device_class || ""}|${c.state_class || ""}`;
      };

      const _candidate_index = () => {
        const items = Array.isArray(this._config_state.scan_result?.candidates) ? this._config_state.scan_result.candidates : [];
        const map = new Map();
        for (const c of items) {
          if (!c || !c.entity_id) continue;
          map.set(c.entity_id, c);
        }
        return map;
      };

      const _validate_no_duplicate_groups = (entity_ids) => {
        const idx = _candidate_index();
        const seen = new Map();
        const conflicts = new Map();

        for (const eid of entity_ids || []) {
          const c = idx.get(eid);
          const gk = _group_key_for_candidate(c);
          if (!gk) continue;

          const prev = seen.get(gk);
          if (!prev) {
            seen.set(gk, eid);
            continue;
          }

          conflicts.set(gk, [prev, eid]);
        }

        if (!conflicts.size) return null;

        const lines = [];
        lines.push("doublons:interdit");
        for (const [gk, pair] of conflicts.entries()) {
          lines.push(`${gk} -> ${pair.join(" , ")}`);
        }
        return lines.join("\n");
      };

      if (!this._config_state.catalogue && !this._config_state.loading) {
        this._config_state.loading = true;
        this._config_state.error = null;
        this._config_state.message = null;
        this._config_state.pricing_error = null;
        this._config_state.pricing_message = null;
        this._render();

        try {
          this._config_state.scan_result = await window.hse_scan_api.fetch_scan(this._hass, {
            include_disabled: false,
            exclude_hse: true,
          });

          const cat = await window.hse_config_api.fetch_catalogue(this._hass);
          _update_from_catalogue(cat);

          const pricingResp = await window.hse_config_api.fetch_pricing(this._hass);
          _update_from_pricing(pricingResp);

          await this._fetch_reference_status();
        } catch (err) {
          this._config_state.error = this._err_msg(err);
        } finally {
          this._config_state.loading = false;
          this._render();
        }
        return;
      }

      this._ensure_reference_status_polling();

      window.hse_config_view.render_config(container, this._config_state, async (action, value) => {
        const _deep_set = (obj, path, v) => {
          if (!obj || typeof obj !== "object") return;
          const parts = String(path || "").split(".").filter(Boolean);
          if (!parts.length) return;
          let cur = obj;
          for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i];
            if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
            cur = cur[k];
          }
          cur[parts[parts.length - 1]] = v;
        };

        if (action === "cost_filter") {
          this._config_state.cost_filter_q = value || "";
          this._storage_set("hse_config_cost_filter_q", this._config_state.cost_filter_q);
          this._render();
          return;
        }

        if (action === "cost_auto_select") {
          const entity_ids = Array.isArray(value?.entity_ids) ? value.entity_ids : [];
          _ensure_pricing_draft();
          this._config_state.pricing_draft.cost_entity_ids = entity_ids;
          if (_remove_ref_from_cost()) {
            this._config_state.pricing_message = "Garde-fou: le capteur de référence a été retiré des capteurs de calcul.";
          } else {
            this._config_state.pricing_message = `Sélection automatique appliquée (${entity_ids.length} capteurs).`;
          }
          this._config_state.pricing_error = null;
          this._render();
          return;
        }

        if (action === "pricing_list_replace") {
          const from = value?.from_entity_id;
          const to = value?.to_entity_id;
          if (!from || !to) return;

          const ids = _cost_ids().filter((x) => x !== from);
          if (!ids.includes(to)) ids.push(to);
          this._config_state.pricing_draft.cost_entity_ids = ids;

          this._config_state.pricing_message = `Remplacement: ${from} → ${to}`;
          this._config_state.pricing_error = null;
          this._render();
          return;
        }

        if (action === "select_reference") {
          this._config_state.selected_reference_entity_id = value;
          this._config_state.message = null;
          this._config_state.reference_status_error = null;

          const next_effective_entity_id = value || this._config_state.current_reference_entity_id || null;
          if ((this._config_state.reference_status?.entity_id || null) !== next_effective_entity_id) {
            this._config_state.reference_status = null;
          }

          this._render();
          await this._fetch_reference_status(value || undefined);
          return;
        }

        if (action === "pricing_patch") {
          const path = value?.path;
          const v = value?.value;
          const no_render = value?.no_render === true;

          _ensure_pricing_draft();
          _deep_set(this._config_state.pricing_draft, path, v);

          if (path === "contract_type") {
            this._deep_fill_missing(this._config_state.pricing_draft, this._config_state.pricing_defaults || {});
          }

          this._config_state.pricing_message = null;
          this._config_state.pricing_error = null;

          if (!no_render) this._render();
          return;
        }

        if (action === "pricing_list_add") {
          const eid = value?.entity_id;
          if (!eid) return;

          const ref = _effective_ref();
          if (ref && eid === ref) {
            this._config_state.pricing_message = "Impossible: le capteur de référence ne peut pas être inclus dans les capteurs de calcul.";
            this._config_state.pricing_error = null;
            this._render();
            return;
          }

          const ids = _cost_ids();

          const idx = _candidate_index();
          const cand = idx.get(eid);
          const gk = _group_key_for_candidate(cand);
          if (gk) {
            for (const existing of ids) {
              const cc = idx.get(existing);
              if (!cc) continue;
              const gg = _group_key_for_candidate(cc);
              if (gg && gg === gk && existing !== eid) {
                this._config_state.pricing_message = `Doublon interdit: ${eid} est équivalent à ${existing} (même appareil). Utilise Remplacer.`;
                this._config_state.pricing_error = null;
                this._render();
                return;
              }
            }
          }

          if (!ids.includes(eid)) ids.push(eid);
          this._config_state.pricing_draft.cost_entity_ids = ids;
          this._config_state.pricing_message = null;
          this._config_state.pricing_error = null;
          this._render();
          return;
        }

        if (action === "pricing_list_remove") {
          const eid = value?.entity_id;
          if (!eid) return;
          const ids = _cost_ids().filter((x) => x !== eid);
          this._config_state.pricing_draft.cost_entity_ids = ids;
          this._config_state.pricing_message = null;
          this._config_state.pricing_error = null;
          this._render();
          return;
        }

        if (action === "pricing_clear") {
          const ok = window.confirm("Effacer les tarifs enregistrés ?");
          if (!ok) return;

          this._config_state.pricing_saving = true;
          this._config_state.pricing_error = null;
          this._config_state.pricing_message = "Suppression…";
          this._render();

          try {
            await window.hse_config_api.clear_pricing(this._hass);
            const pricingResp = await window.hse_config_api.fetch_pricing(this._hass);
            this._config_state.pricing_draft = null;
            _update_from_pricing(pricingResp);
            this._config_state.pricing_message = "Tarifs effacés.";
          } catch (err) {
            this._config_state.pricing_error = this._err_msg(err);
          } finally {
            this._config_state.pricing_saving = false;
            this._render();
          }
          return;
        }

        if (action === "pricing_save") {
          _ensure_pricing_draft();
          this._deep_fill_missing(this._config_state.pricing_draft, this._config_state.pricing_defaults || {});

          if (_remove_ref_from_cost()) {
            this._config_state.pricing_message = "Garde-fou: le capteur de référence a été retiré des capteurs de calcul.";
          }

          const errDup = _validate_no_duplicate_groups(_cost_ids());
          if (errDup) {
            this._config_state.pricing_error = errDup;
            this._config_state.pricing_message = "Impossible de sauvegarder: doublons détectés dans la sélection.";
            this._render();
            return;
          }

          this._config_state.pricing_saving = true;
          this._config_state.pricing_error = null;
          this._config_state.pricing_message = "Sauvegarde en préparation…";
          this._render();

          await new Promise((resolve) => {
            try {
              window.requestAnimationFrame(() => resolve());
            } catch (_) {
              window.setTimeout(resolve, 0);
            }
          });

          const ok = window.confirm("Sauvegarder ces tarifs (et la sélection de capteurs) ?\nEnsuite HSE va créer automatiquement les helpers nécessaires.");
          if (!ok) {
            this._config_state.pricing_saving = false;
            this._config_state.pricing_message = null;
            this._render();
            return;
          }

          const ids_for_enrich = _cost_ids().slice();

          this._config_state.pricing_error = null;
          this._config_state.pricing_message = "Sauvegarde…";
          this._render();

          try {
            await window.hse_config_api.set_pricing(this._hass, this._config_state.pricing_draft);
            const pricingResp = await window.hse_config_api.fetch_pricing(this._hass);
            this._config_state.pricing_draft = null;
            _update_from_pricing(pricingResp);

            this._config_state.pricing_message = "Tarifs sauvegardés. Création des capteurs (helpers) en cours… (attends ~30s, ou redémarre HA si certains restent indisponibles).";
            this._render();

            if (window.hse_enrich_api?.apply) {
              try {
                const applied = await window.hse_enrich_api.apply(this._hass, { mode: "create_helpers", entity_ids: ids_for_enrich });
                const sc = applied?.summary || {};
                const created = sc.created_count ?? (Array.isArray(applied?.created) ? applied.created.length : 0);
                const skipped = sc.skipped_count ?? (Array.isArray(applied?.skipped) ? applied.skipped.length : 0);
                const errs = sc.errors_count ?? (Array.isArray(applied?.errors) ? applied.errors.length : 0);

                if (errs > 0) {
                  this._config_state.pricing_message = `Tarifs sauvegardés. Helpers: créés ${created}, ignorés ${skipped}, erreurs ${errs}. Si besoin, utilise l'onglet Migration pour un export YAML.`;
                } else {
                  this._config_state.pricing_message = `Tarifs sauvegardés. Helpers: créés ${created}, ignorés ${skipped}. (attends ~30s)`;
                }
              } catch (err) {
                this._config_state.pricing_message = `Tarifs sauvegardés. Création auto des helpers en échec: ${this._err_msg(err)}. Utilise Migration pour exporter le YAML.`;
              }
            } else {
              this._config_state.pricing_message = "Tarifs sauvegardés. Enrich API non disponible pour créer automatiquement les helpers (utilise Migration pour exporter le YAML).";
            }
          } catch (err) {
            this._config_state.pricing_error = this._err_msg(err);
          } finally {
            this._config_state.pricing_saving = false;
            this._render();
          }
          return;
        }

        if (action === "refresh") {
          this._config_state.loading = true;
          this._config_state.error = null;
          this._config_state.message = null;
          this._config_state.pricing_error = null;
          this._config_state.pricing_message = null;
          this._config_state.reference_status_error = null;
          this._render();

          try {
            await window.hse_config_api.refresh_catalogue(this._hass);

            this._config_state.scan_result = await window.hse_scan_api.fetch_scan(this._hass, {
              include_disabled: false,
              exclude_hse: true,
            });

            const cat = await window.hse_config_api.fetch_catalogue(this._hass);
            _update_from_catalogue(cat);

            const pricingResp = await window.hse_config_api.fetch_pricing(this._hass);
            _update_from_pricing(pricingResp);

            await this._fetch_reference_status();
          } catch (err) {
            this._config_state.error = this._err_msg(err);
          } finally {
            this._config_state.loading = false;
            this._render();
          }
          return;
        }

        if (action === "clear_reference") {
          const ok = window.confirm("Supprimer la référence compteur ?");
          if (!ok) return;

          this._config_state.saving = true;
          this._config_state.error = null;
          this._config_state.message = null;
          this._config_state.reference_status_error = null;
          this._render();

          try {
            await window.hse_config_api.set_reference_total(this._hass, null);
            const cat = await window.hse_config_api.fetch_catalogue(this._hass);
            _update_from_catalogue(cat);
            this._config_state.selected_reference_entity_id = null;
            this._config_state.reference_status = null;
            await this._fetch_reference_status(null);
            this._config_state.message = "Référence supprimée.";
          } catch (err) {
            this._config_state.error = this._err_msg(err);
          } finally {
            this._config_state.saving = false;
            this._render();
          }
          return;
        }

        if (action === "save_reference") {
          const entity_id = this._config_state.selected_reference_entity_id;
          if (!entity_id) {
            this._config_state.message = "Aucune référence sélectionnée (rien à sauvegarder).";
            this._render();
            return;
          }

          _ensure_pricing_draft();
          const ids = _cost_ids();
          if (ids.includes(entity_id)) {
            this._config_state.pricing_draft.cost_entity_ids = ids.filter((x) => x !== entity_id);
            this._config_state.pricing_message = "Garde-fou: la référence a été retirée des capteurs de calcul.";
          }

          const ok = window.confirm(`Définir la référence compteur sur ${entity_id} ?\n(Elle sera exclue des totaux mesurés)`);
          if (!ok) return;

          this._config_state.saving = true;
          this._config_state.error = null;
          this._config_state.message = null;
          this._config_state.reference_status_error = null;
          this._render();

          try {
            try {
              await window.hse_config_api.set_reference_total(this._hass, entity_id);
            } catch (err) {
              await window.hse_config_api.refresh_catalogue(this._hass);
              await window.hse_config_api.set_reference_total(this._hass, entity_id);
            }

            const cat = await window.hse_config_api.fetch_catalogue(this._hass);
            _update_from_catalogue(cat);
            await this._fetch_reference_status(entity_id);
            this._config_state.message = "Référence sauvegardée.";
          } catch (err) {
            this._config_state.error = this._err_msg(err);
          } finally {
            this._config_state.saving = false;
            this._render();
          }
          return;
        }
      });
    }

    async _render_diagnostic() {
      const { el } = window.hse_dom;
      const container = this._ui.content;

      if (!window.hse_diag_view || !window.hse_diag_api) {
        this._render_placeholder("Diagnostic", "diagnostic.view.js non chargé.");
        return;
      }

      const diag_api = {
        fetch_catalogue: () => window.hse_diag_api.fetch_catalogue(this._hass),
        refresh_catalogue: () => window.hse_diag_api.refresh_catalogue(this._hass),
        set_item_triage: (item_id, triage) => window.hse_diag_api.set_item_triage(this._hass, item_id, triage),
        bulk_triage: (item_ids, triage) => window.hse_diag_api.bulk_triage(this._hass, item_ids, triage),
        check_consistency: (payload) => this._hass.callApi("post", "hse/unified/diagnostic/check", payload),
      };

      const _wrap_last = async (label, fn, request_meta) => {
        try {
          this._diag_state.last_action = label;
          this._diag_state.last_request = request_meta || null;
          const resp = await fn();
          this._diag_state.last_response = resp;
          return resp;
        } catch (err) {
          this._diag_state.last_response = { error: this._err_msg(err) };
          throw err;
        }
      };

      const _default_check_request = (entity_ids) => ({
        entity_ids,
        checks: ["catalogue_duplicates", "config_entry_consistency", "entity_presence", "helper_consistency"],
        include_history: true,
      });

      if (!this._diag_state.data && !this._diag_state.loading) {
        this._diag_state.loading = true;
        try {
          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });
          this._diag_state.error = null;
        } catch (err) {
          this._diag_state.error = this._err_msg(err);
        } finally {
          this._diag_state.loading = false;
        }
      }

      if (this._diag_state.error) {
        container.appendChild(el("div", "hse_card", `Erreur: ${this._diag_state.error}`));
        return;
      }

      if (!this._diag_state.data) {
        container.appendChild(el("div", "hse_card", "Chargement…"));
        return;
      }

      const _selected_ids = () => Object.keys(this._diag_state.selected || {}).filter((k) => this._diag_state.selected[k]);

      const _mute_until_days = (days) => {
        const fn = window.hse_diag_view?._local_iso_days_from_now;
        if (fn) return fn(days);

        const dd = new Date();
        dd.setDate(dd.getDate() + days);
        const pad = (n) => String(n).padStart(2, "0");
        const yyyy = dd.getFullYear(),
          mm = pad(dd.getMonth() + 1),
          da = pad(dd.getDate());
        const hh = pad(dd.getHours()),
          mi = pad(dd.getMinutes()),
          ss = pad(dd.getSeconds());
        const tzMin = -dd.getTimezoneOffset();
        const sign = tzMin >= 0 ? "+" : "-";
        const tzAbs = Math.abs(tzMin);
        const tzh = pad(Math.floor(tzAbs / 60)),
          tzm = pad(tzAbs % 60);
        return `${yyyy}-${mm}-${da}T${hh}:${mi}:${ss}${sign}${tzh}:${tzm}`;
      };

      const _filtered_ids = () => {
        const fn = window.hse_diag_view?._filtered_escalated_items;
        if (!fn) return [];
        return fn(this._diag_state.data, this._diag_state.filter_q).map((x) => x.id);
      };

      const _filtered_entity_ids = () => {
        const filtered = window.hse_diag_view?._filtered_escalated_items?.(this._diag_state.data, this._diag_state.filter_q) || [];
        const grouped = window.hse_diag_view?._group_escalated_items?.(filtered) || [];
        return grouped.map((g) => g.entity_id).filter(Boolean);
      };

      const _all_entity_ids = () => {
        const items = this._diag_state.data?.items || {};
        return Array.from(
          new Set(
            Object.values(items)
              .map((x) => x?.source?.entity_id)
              .filter(Boolean)
          )
        ).sort();
      };

      window.hse_diag_view.render_diagnostic(container, this._diag_state.data, this._diag_state, async (action, payload) => {
        if (action === "toggle_advanced") {
          this._diag_state.advanced = !this._diag_state.advanced;
          this._storage_set("hse_diag_advanced", this._diag_state.advanced ? "1" : "0");
          this._render();
          return;
        }

        if (action === "filter") {
          this._diag_state.filter_q = payload || "";
          this._storage_set("hse_diag_filter_q", this._diag_state.filter_q);
          this._diag_state.selected = {};
          this._storage_set("hse_diag_selected", "{}");
          this._render();
          return;
        }

        if (action === "select") {
          if (payload && payload.item_id) {
            this._diag_state.selected[payload.item_id] = !!payload.checked;
            this._storage_set("hse_diag_selected", JSON.stringify(this._diag_state.selected));
          }
          this._render();
          return;
        }

        if (action === "select_none") {
          this._diag_state.selected = {};
          this._storage_set("hse_diag_selected", "{}");
          this._render();
          return;
        }

        if (action === "select_all_filtered") {
          const ids = _filtered_ids();
          for (const id of ids) this._diag_state.selected[id] = true;
          this._storage_set("hse_diag_selected", JSON.stringify(this._diag_state.selected));
          this._render();
          return;
        }

        if (action === "check_coherence") {
          const entity_ids = _filtered_entity_ids();
          const req = _default_check_request(entity_ids.length ? entity_ids : _all_entity_ids());

          this._diag_state.check_loading = true;
          this._diag_state.check_error = null;
          this._render();

          try {
            this._diag_state.check_result = await _wrap_last("diagnostic_check", () => diag_api.check_consistency(req), {
              method: "post",
              path: "hse/unified/diagnostic/check",
              body: req,
            });
            this._diag_state.check_error = null;
          } catch (err) {
            this._diag_state.check_error = this._err_msg(err);
          } finally {
            this._diag_state.check_loading = false;
            this._render();
          }
          return;
        }

        if (action === "bulk_mute") {
          const mode = payload?.mode || "selection";
          const ids = mode === "filtered" ? _filtered_ids() : _selected_ids();
          if (!ids.length) return;

          const days = payload?.days || 7;
          const mute_until = _mute_until_days(days);

          const ok = window.confirm(`Appliquer MUTE ${days}j sur ${ids.length} item(s) (${mode}) ?`);
          if (!ok) return;

          await _wrap_last("bulk_triage/mute", () => diag_api.bulk_triage(ids, { mute_until }), {
            method: "post",
            path: "hse/unified/catalogue/triage/bulk",
            body: { item_ids: ids, triage: { mute_until } },
          });
          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });
          this._render();
          return;
        }

        if (action === "bulk_removed") {
          const mode = payload?.mode || "selection";
          const ids = mode === "filtered" ? _filtered_ids() : _selected_ids();
          if (!ids.length) return;

          const ok = window.confirm(`Appliquer REMOVED sur ${ids.length} item(s) (${mode}) ?`);
          if (!ok) return;

          await _wrap_last("bulk_triage/removed", () => diag_api.bulk_triage(ids, { policy: "removed" }), {
            method: "post",
            path: "hse/unified/catalogue/triage/bulk",
            body: { item_ids: ids, triage: { policy: "removed" } },
          });
          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });
          this._render();
          return;
        }

        if (action === "consolidate_history") {
          const entity_id = payload?.entity_id;
          const ids = Array.isArray(payload?.item_ids) ? payload.item_ids.filter(Boolean) : [];
          if (!entity_id || !ids.length) return;

          const ok = window.confirm(`Archiver ${ids.length} doublon(s) historique(s) pour ${entity_id} ?`);
          if (!ok) return;

          await _wrap_last("bulk_triage/archived", () => diag_api.bulk_triage(ids, { policy: "archived", note: "auto_consolidated_from_diagnostic" }), {
            method: "post",
            path: "hse/unified/catalogue/triage/bulk",
            body: { item_ids: ids, triage: { policy: "archived", note: "auto_consolidated_from_diagnostic" } },
          });

          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });

          const req = _default_check_request([entity_id]);
          this._diag_state.check_loading = true;
          this._diag_state.check_error = null;
          this._render();
          try {
            this._diag_state.check_result = await _wrap_last("diagnostic_check", () => diag_api.check_consistency(req), {
              method: "post",
              path: "hse/unified/diagnostic/check",
              body: req,
            });
            this._diag_state.check_error = null;
          } catch (err) {
            this._diag_state.check_error = this._err_msg(err);
          } finally {
            this._diag_state.check_loading = false;
            this._render();
          }
          return;
        }

        if (action === "refresh") {
          await _wrap_last("refresh_catalogue", () => diag_api.refresh_catalogue(), {
            method: "post",
            path: "hse/unified/catalogue/refresh",
            body: {},
          });
          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });
          this._render();
          return;
        }

        if (action === "mute") {
          await _wrap_last("set_item_triage/mute", () => diag_api.set_item_triage(payload.item_id, { mute_until: payload.mute_until }), {
            method: "post",
            path: `hse/unified/catalogue/item/${payload.item_id}/triage`,
            body: { mute_until: payload.mute_until },
          });
          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });
          this._render();
          return;
        }

        if (action === "removed") {
          await _wrap_last("set_item_triage/removed", () => diag_api.set_item_triage(payload.item_id, { policy: "removed" }), {
            method: "post",
            path: `hse/unified/catalogue/item/${payload.item_id}/triage`,
            body: { policy: "removed" },
          });
          this._diag_state.data = await _wrap_last("fetch_catalogue", () => diag_api.fetch_catalogue(), {
            method: "get",
            path: "hse/unified/catalogue",
            body: null,
          });
          this._render();
          return;
        }
      });
    }

    async _render_custom() {
      const container = this._ui.content;

      if (!window.hse_custom_view?.render_customisation) {
        this._render_placeholder("Customisation", "custom.view.js non chargé.");
        return;
      }

      if (!this._org_state.meta_store && !this._org_state.loading && !this._org_state.error) {
        this._org_fetch_meta();
      }

      window.hse_custom_view.render_customisation(container, this._custom_state, this._org_state, (action, value) => {
        if (action === "set_theme") {
          this._set_theme(value || "ha");
          return;
        }

        if (action === "toggle_dynamic_bg") {
          this._custom_state.dynamic_bg = !this._custom_state.dynamic_bg;
          this._storage_set("hse_custom_dynamic_bg", this._custom_state.dynamic_bg ? "1" : "0");
          this._apply_dynamic_bg_override();
          this._render();
          return;
        }

        if (action === "toggle_glass") {
          this._custom_state.glass = !this._custom_state.glass;
          this._storage_set("hse_custom_glass", this._custom_state.glass ? "1" : "0");
          this._apply_glass_override();
          this._render();
          return;
        }

        if (action === "org_refresh") {
          this._org_fetch_meta();
          return;
        }

        if (action === "org_preview") {
          this._org_preview();
          return;
        }

        if (action === "org_apply") {
          this._org_apply(value?.apply_mode || "auto");
          return;
        }

        if (action === "org_save") {
          this._org_save_meta();
          return;
        }

        if (action === "org_draft_reset") {
          const ok = window.confirm("Réinitialiser le brouillon (perdre les modifications locales non sauvegardées) ?");
          if (!ok) return;
          this._org_reset_draft_from_store();
          this._render();
          return;
        }

        if (action === "org_patch") {
          const path = value?.path;
          const v = value?.value;
          const no_render = value?.no_render === true;

          this._org_ensure_draft();
          this._deep_set(this._org_state.meta_draft, path, v);
          this._org_state.dirty = true;

          if (!no_render) this._render();
          return;
        }

        if (action === "org_room_add") {
          const room_id = value?.room_id;
          const name = value?.name;
          if (!room_id) return;

          this._org_ensure_draft();
          const rooms = this._org_state.meta_draft.rooms;
          if (rooms[room_id]) {
            this._org_state.message = `Room existe déjà: ${room_id}`;
            this._render();
            return;
          }

          rooms[room_id] = {
            name: name || room_id,
            mode: "mixed",
            name_mode: "mixed",
            ha_area_id: null,
          };

          this._org_state.dirty = true;
          this._org_state.message = `Room ajoutée: ${room_id}`;
          this._render();
          return;
        }

        if (action === "org_room_delete") {
          const room_id = value?.room_id;
          if (!room_id) return;

          this._org_ensure_draft();
          delete this._org_state.meta_draft.rooms[room_id];
          this._org_state.dirty = true;
          this._org_state.message = `Room supprimée: ${room_id}`;
          this._render();
          return;
        }

        if (action === "org_assignment_add") {
          const entity_id = value?.entity_id;
          if (!entity_id) return;

          this._org_ensure_draft();
          const asg = this._org_state.meta_draft.assignments;
          if (asg[entity_id]) {
            this._org_state.message = `Assignment existe déjà: ${entity_id}`;
            this._render();
            return;
          }

          asg[entity_id] = {
            room_id: null,
            room_mode: "mixed",
            type_id: null,
            type_mode: "mixed",
          };

          this._org_state.dirty = true;
          this._org_state.message = `Assignment ajoutée: ${entity_id}`;
          this._render();
          return;
        }

        if (action === "org_assignment_delete") {
          const entity_id = value?.entity_id;
          if (!entity_id) return;

          this._org_ensure_draft();
          delete this._org_state.meta_draft.assignments[entity_id];
          this._org_state.dirty = true;
          this._org_state.message = `Assignment supprimée: ${entity_id}`;
          this._render();
          return;
        }

        if (action === "org_filter_rooms") {
          this._org_state.rooms_filter_q = String(value || "");
          this._render();
          return;
        }

        if (action === "org_filter_assignments") {
          this._org_state.assignments_filter_q = String(value || "");
          this._render();
          return;
        }

        if (action === "org_toggle_raw") {
          this._org_state.show_raw = !this._org_state.show_raw;
          this._render();
          return;
        }
      });
    }

    async _render_costs() {
      const { el, clear } = window.hse_dom;
      const container = this._ui.content;

      this._ensure_overview_autorefresh();

      const card = el("div", "hse_card");
      const toolbar = el("div", "hse_toolbar");

      const btn = el("button", "hse_button hse_button_primary", "Rafraîchir");
      btn.addEventListener("click", async () => {
        this._overview_data = null;
        this._render();

        try {
          const fn = window.hse_overview_api?.fetch_overview || window.hse_overview_api?.fetch_manifest_and_ping;
          if (!fn) throw new Error("overview_api_not_loaded");
          this._overview_data = await fn(this._hass);
        } catch (err) {
          this._overview_data = { error: this._err_msg(err) };
        }

        this._render();
      });

      toolbar.appendChild(btn);
      card.appendChild(toolbar);
      container.appendChild(card);

      const body = el("div");
      container.appendChild(body);

      if (!this._overview_data) {
        body.appendChild(el("div", "hse_subtitle", "Chargement…"));
        return;
      }

      if (this._overview_data?.error) {
        const err_card = el("div", "hse_card");
        err_card.appendChild(el("div", null, "Erreur"));
        err_card.appendChild(el("pre", "hse_code", String(this._overview_data.error)));
        body.appendChild(err_card);
        return;
      }

      clear(body);
      if (!window.hse_costs_view?.render_costs) {
        this._render_placeholder("Analyse de coûts", "costs.view.js non chargé.");
        return;
      }
      window.hse_costs_view.render_costs(body, this._overview_data, this._hass);
    }

    async _render_overview() {
      const { el, clear } = window.hse_dom;
      const container = this._ui.content;

      this._ensure_overview_autorefresh();

      const card = el("div", "hse_card");
      const toolbar = el("div", "hse_toolbar");

      const btn = el("button", "hse_button hse_button_primary", "Rafraîchir");
      btn.addEventListener("click", async () => {
        this._overview_data = null;
        this._render();

        try {
          const fn = window.hse_overview_api?.fetch_overview || window.hse_overview_api?.fetch_manifest_and_ping;
          if (!fn) throw new Error("overview_api_not_loaded");
          this._overview_data = await fn(this._hass);
        } catch (err) {
          this._overview_data = { error: this._err_msg(err) };
        }

        this._render();
      });

      toolbar.appendChild(btn);
      card.appendChild(toolbar);
      container.appendChild(card);

      const body = el("div");
      container.appendChild(body);

      if (!this._overview_data) {
        body.appendChild(el("div", "hse_subtitle", "Chargement…"));
        return;
      }

      if (this._overview_data?.error) {
        const err_card = el("div", "hse_card");
        err_card.appendChild(el("div", null, "Erreur"));
        err_card.appendChild(el("pre", "hse_code", String(this._overview_data.error)));
        body.appendChild(err_card);
        return;
      }

      clear(body);
      window.hse_overview_view.render_overview(body, this._overview_data, this._hass);
    }

    _render_scan() {
      const container = this._ui.content;

      window.hse_scan_view.render_scan(container, this._scan_result, this._scan_state, async (action, value) => {
        if (action === "filter") {
          this._scan_state.filter_q = value || "";
          this._render();
          return;
        }

        if (action === "set_group_open") {
          const { id, open, no_render } = value || {};
          if (id) {
            this._scan_state.groups_open[id] = !!open;
            this._storage_set("hse_scan_groups_open", JSON.stringify(this._scan_state.groups_open));
          }
          if (!no_render) this._render();
          return;
        }

        if (action === "open_all") {
          this._scan_state.open_all = true;
          this._storage_set("hse_scan_open_all", "1");
          this._render();
          return;
        }

        if (action === "close_all") {
          this._scan_state.open_all = false;
          this._scan_state.groups_open = {};
          this._storage_set("hse_scan_open_all", "0");
          this._storage_set("hse_scan_groups_open", "{}");
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
            this._scan_result = { error: this._err_msg(err), integrations: [], candidates: [] };
          } finally {
            this._scan_state.scan_running = false;
            this._render();
          }
        }
      });
    }
  }

  customElements.define("hse-panel", hse_panel);
})();
