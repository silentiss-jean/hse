/* hse_panel.js — Phase 2B (single-root router, vanilla HTMLElement)
   Architecture : UN SEUL custom element → hse-panel.
   Les onglets sont des modules JS purs exposant { mount, update_hass, unmount }.
   Enregistrés dans window.hse_tabs_registry[tab_id].
   Plus aucun customElements.get/define pour les onglets dans ce fichier.

   Contrat tab_module :
     mount(container, ctx)    → construit le DOM dans container, lance les abonnements
     update_hass(hass)        → propage hass sans reconstruire le DOM
     unmount()                → détache les abonnements, libère les ressources

   Contexte passé aux tabs (ctx) :
     { hass, panel, actions, live_store, live_service }

   Router mount-once :
     _show_tab(tab_id)        → affiche/masque les wrappers, délègue à _mount_tab_module
     _mount_tab_module(tab_id)→ premier montage via registre, stocke dans _mounted

   Corrections appliquées :
     fix #1 — shell.js supprimé du boot : NAV_ITEMS est défini ici uniquement.
              shell.js était dead code (NAV dupliqué, jamais appelé par le panel).
     fix #2 — store reinit : comparaison par référence objet (window.__hse_last_store_ref)
              au lieu de _instance_id injecté à la volée.
     fix #3 — boot retry : _booting est géré par finally.
*/

const build_signature = "2026-04-07_single_root_fix1";

(function () {
  const PANEL_BASE  = "/api/hse/static/panel";
  const SHARED_BASE = "/api/hse/static/shared";
  const ASSET_V     = "0.1.53";

  // ── Bootstrap loader (fallback si loader.js non chargé en amont) ──────
  function _ensure_loader() {
    if (window.hse_loader) return;
    const loaded_urls = new Set();
    window.hse_loader = {
      load_script_once: (url) => {
        if (loaded_urls.has(url)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          if (document.querySelector(`script[src="${url}"]`)) {
            loaded_urls.add(url); resolve(); return;
          }
          const s = document.createElement('script');
          s.src = url; s.async = true;
          s.onload  = () => { loaded_urls.add(url); resolve(); };
          s.onerror = () => reject(new Error(`script_load_failed: ${url}`));
          document.head.appendChild(s);
        });
      },
      load_css_text: async (url) => {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`css_load_failed: ${url} (${resp.status})`);
        return resp.text();
      },
    };
    console.warn('[HSE] loader.js absent — fallback loader utilisé.');
  }

  // ── NAV — source unique de vérité (shell.js supprimé — fix #1) ────────
  const NAV_ITEMS = [
    { id: 'overview',   label: 'Accueil' },
    { id: 'diagnostic', label: 'Diagnostic' },
    { id: 'scan',       label: 'Détection' },
    { id: 'config',     label: 'Configuration' },
    { id: 'custom',     label: 'Customisation' },
    { id: 'cards',      label: 'Génération cartes' },
    { id: 'migration',  label: 'Migration capteurs' },
    { id: 'costs',      label: 'Analyse de coûts' },
  ];

  // ════════════════════════════════════════════════════════════════════════
  // HsePanel — seul et unique custom element du panel
  // ════════════════════════════════════════════════════════════════════════
  class HsePanel extends HTMLElement {
    constructor() {
      super();
      this._hass_raw   = null;
      this._active_tab = 'overview';
      this._boot_done  = false;
      this._boot_error = null;
      this._booting    = false;
      this._theme      = 'ha';
      this._actions    = null;
      this._css_text   = '';

      // mount-once : { tab_id → { container: HTMLElement, module: tab_module|null } }
      this._mounted = {};

      // Refs DOM (construites une seule fois dans _build_shell)
      this._dom = { style: null, header: null, tabs: null, content: null };

      this._user_interacting       = false;
      this._user_interacting_timer = null;
      this._doc_mousedown = () => this._mark_interacting();
      this._doc_focusin   = (e) => {
        if (e.composedPath?.().some(n => n === this)) this._mark_interacting();
      };
      this._on_visibility_change = () => {
        if (document.visibilityState !== 'visible' || !this._boot_done) return;
        let _attempts = 0;
        const _poll = () => {
          const ha    = document.querySelector('home-assistant');
          const fresh = ha?.hass;
          if (fresh) { this.hass = fresh; return; }
          if (++_attempts < 20) setTimeout(_poll, 500);
        };
        _poll();
      };
    }

    // ── hass setter ────────────────────────────────────────────────────
    set hass(hass) {
      this._hass_raw = hass;
      window.hse_live_service?.update_hass?.(hass);
      if (!this._boot_done) {
        if (!this._booting) this._boot();
        return;
      }
      const mounted = this._mounted[this._active_tab];
      if (mounted?.module?.update_hass) {
        try { mounted.module.update_hass(hass); } catch (_) {}
      }
    }
    get hass() { return this._hass_raw; }

    // ── Cycle de vie ───────────────────────────────────────────────────
    connectedCallback() {
      console.info(`[HSE] panel loaded (${build_signature})`);
      window.__hse_panel_loaded = build_signature;
      window.hse_panel_instance = this;

      this._theme = this._storage_get('hse_theme') || 'ha';
      this.setAttribute('data-theme', this._theme);
      this._apply_dynamic_bg_override();
      this._apply_glass_override();

      const saved_tab = this._storage_get('hse_active_tab');
      if (saved_tab && NAV_ITEMS.some(i => i.id === saved_tab)) {
        this._active_tab = saved_tab;
      }

      this.addEventListener('mousedown',  () => this._mark_interacting(), true);
      this.addEventListener('focusin',    () => this._mark_interacting(), true);
      this.addEventListener('keydown',    () => this._mark_interacting(), true);
      this.addEventListener('touchstart', () => this._mark_interacting(), { passive: true, capture: true });
      document.addEventListener('mousedown',        this._doc_mousedown, true);
      document.addEventListener('focusin',          this._doc_focusin,   true);
      document.addEventListener('visibilitychange', this._on_visibility_change);

      this._render_loading();
      if (!this._boot_done && !this._booting) this._boot();
    }

    disconnectedCallback() {
      if (this._user_interacting_timer) clearTimeout(this._user_interacting_timer);
      document.removeEventListener('mousedown',        this._doc_mousedown, true);
      document.removeEventListener('focusin',          this._doc_focusin,   true);
      document.removeEventListener('visibilitychange', this._on_visibility_change);
      for (const [, m] of Object.entries(this._mounted)) {
        try { m.module?.unmount?.(); } catch (_) {}
      }
      this._mounted = {};
      window.hse_panel_instance = null;
    }

    // ── États transitoires ─────────────────────────────────────────────
    _render_loading() {
      this.innerHTML = '<div style="padding:16px;opacity:.6">Chargement HSE…</div>';
    }

    _render_boot_error(msg) {
      this.innerHTML = `
        <style>
          hse-panel { display:block; padding:16px; font-family:system-ui; }
          pre { white-space:pre-wrap; word-break:break-word; background:rgba(0,0,0,.2); padding:12px; border-radius:10px; }
        </style>
        <h2>Home Suivi Elec — Boot error</h2>
        <pre>${_esc(msg)}</pre>`;
    }

    // ── Shell (construit une seule fois après le boot) ─────────────────
    _build_shell() {
      this.innerHTML = '';

      const style = document.createElement('style');
      style.textContent = this._css_text;
      this.appendChild(style);
      this._dom.style = style;

      const page  = _el('div', 'hse_page');
      const shell = _el('div', 'hse_shell');

      const header = _el('div', 'hse_header');
      this._dom.header = header;
      shell.appendChild(header);
      this._render_header();

      const tabs = _el('div', 'hse_tabs');
      this._dom.tabs = tabs;
      shell.appendChild(tabs);
      this._render_nav();

      const content = _el('div');
      content.id = 'hse-content';
      content.dataset.tab = this._active_tab;
      this._dom.content = content;
      shell.appendChild(content);

      page.appendChild(shell);
      this.appendChild(page);
    }

    _render_header() {
      const el = this._dom.header;
      if (!el) return;
      const user = this._hass_raw?.user?.name || '—';
      el.innerHTML = '';
      const left = _el('div');
      const h1   = _el('h1', 'hse_title');
      h1.textContent = 'Home Suivi Elec';
      const sub  = _el('div', 'hse_subtitle');
      sub.textContent = `v${ASSET_V}`;
      left.appendChild(h1);
      left.appendChild(sub);
      const right = _el('div', 'hse_subtitle');
      right.textContent = `user: ${user}`;
      el.appendChild(left);
      el.appendChild(right);
    }

    _render_nav() {
      const el = this._dom.tabs;
      if (!el) return;
      el.innerHTML = '';
      for (const item of NAV_ITEMS) {
        const btn = _el('button', 'hse_tab');
        btn.textContent    = item.label;
        btn.dataset.tabId  = item.id;
        btn.dataset.active = item.id === this._active_tab ? 'true' : 'false';
        btn.addEventListener('click', () => this._switch_tab(item.id));
        el.appendChild(btn);
      }
    }

    // ── Routeur mount-once ─────────────────────────────────────────────

    _switch_tab(tab_id) {
      if (tab_id === this._active_tab) return;

      if (this._dom.tabs) {
        for (const btn of this._dom.tabs.querySelectorAll('.hse_tab')) {
          btn.dataset.active = btn.dataset.tabId === tab_id ? 'true' : 'false';
        }
      }

      this._active_tab = tab_id;
      this._storage_set('hse_active_tab', tab_id);

      if (this._hass_raw) window.hse_live_service?.update_hass?.(this._hass_raw);

      if (this._dom.content) {
        this._dom.content.dataset.tab = tab_id;
        this._show_tab(tab_id);
      }
    }

    _show_tab(tab_id) {
      for (const [id, m] of Object.entries(this._mounted)) {
        if (m.container) m.container.style.display = id === tab_id ? '' : 'none';
      }

      const existing = this._mounted[tab_id];
      if (existing) {
        existing.container.style.display = '';
        if (existing.module?.update_hass) {
          try { existing.module.update_hass(this._hass_raw); } catch (_) {}
        }
        return;
      }

      this._mount_tab_module(tab_id);
    }

    _mount_tab_module(tab_id) {
      const container = _el('div', 'hse_tab_host');
      container.dataset.tabHost = tab_id;
      this._dom.content.appendChild(container);

      const registry = window.hse_tabs_registry || {};
      const module   = registry[tab_id];

      if (!module?.mount) {
        container.innerHTML = `<div style="padding:16px;color:var(--error-color,#c00)">
          Onglet "<strong>${_esc(tab_id)}</strong>" non disponible dans hse_tabs_registry.
        </div>`;
        this._mounted[tab_id] = { container, module: null };
        return;
      }

      const ctx = this._build_tab_ctx();

      try {
        module.mount(container, ctx);
        this._mounted[tab_id] = { container, module };
      } catch (err) {
        console.error(`[HSE] mount error on tab "${tab_id}"`, err);
        container.innerHTML = `<div style="padding:16px;color:var(--error-color,#c00)">
          Erreur montage onglet "<strong>${_esc(tab_id)}</strong>" : ${_esc(err.message)}
        </div>`;
        this._mounted[tab_id] = { container, module: null };
      }
    }

    _build_tab_ctx() {
      return {
        hass:         this._hass_raw,
        panel:        this,
        actions:      this._actions,
        live_store:   window.hse_live_store   ?? null,
        live_service: window.hse_live_service ?? null,
      };
    }

    // ── Navigation helpers ─────────────────────────────────────────────
    _set_active_tab(tab_id) { this._switch_tab(tab_id); }

    // ── Thème ──────────────────────────────────────────────────────────
    _set_theme(theme_key) {
      this._theme = theme_key || 'ha';
      this.setAttribute('data-theme', this._theme);
      this._storage_set('hse_theme', this._theme);
    }

    _apply_dynamic_bg_override() {
      const val = (this._storage_get('hse_custom_dynamic_bg') || '1') === '1' ? '' : '0';
      this.style.setProperty('--hse-bg-dynamic-opacity', val);
    }

    _apply_glass_override() {
      const val = (this._storage_get('hse_custom_glass') || '0') === '1'
        ? 'blur(18px) saturate(160%)' : '';
      this.style.setProperty('--hse-backdrop-filter', val);
    }

    // ── Interaction guard ──────────────────────────────────────────────
    _mark_interacting() {
      this._user_interacting = true;
      if (this._user_interacting_timer) clearTimeout(this._user_interacting_timer);
      const schedule = () => {
        this._user_interacting_timer = setTimeout(() => {
          const a  = document.activeElement;
          const sa = this.querySelector(':focus');
          if (a?.tagName === 'SELECT' || sa?.tagName === 'SELECT') { schedule(); return; }
          this._user_interacting       = false;
          this._user_interacting_timer = null;
        }, 2000);
      };
      schedule();
    }

    // ── Storage helpers ────────────────────────────────────────────────
    _storage_get(key) {
      try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }
    _storage_set(key, v) {
      try { window.localStorage.setItem(key, v); } catch (_) {}
    }

    // ── Boot séquentiel ────────────────────────────────────────────────
    async _boot() {
      if (this._boot_done || this._booting) return;
      this._booting = true;

      window.hse_tabs_registry = window.hse_tabs_registry || {};

      try {
        const L = window.hse_loader;

        // Shared
        await L.load_script_once(`${SHARED_BASE}/ui/dom.js?v=${ASSET_V}`);
        await L.load_script_once(`${SHARED_BASE}/ui/table.js?v=${ASSET_V}`);
        await L.load_script_once(`${SHARED_BASE}/hse.store.js?v=${ASSET_V}`);
        await L.load_script_once(`${SHARED_BASE}/hse.fetch.js?v=${ASSET_V}`);

        // Core states
        await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diag.state.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/config/config.state.js?v=${ASSET_V}`);

        // Core services (shell.js supprimé — fix #1)
        await L.load_script_once(`${PANEL_BASE}/core/panel.actions.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/core/live.store.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/core/live.service.js?v=${ASSET_V}`);

        // Features : views + tab modules
        await L.load_script_once(`${PANEL_BASE}/features/overview/overview.state.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/overview/overview.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/overview/overview.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/overview/overview.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/costs/costs.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/costs/costs.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/scan/scan.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/scan/scan.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/scan/scan.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/config/config.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/config/config.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/config/config.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/custom/custom.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/custom/custom.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/cards/cards.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/cards/logic/yamlComposer.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/cards/cards.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/cards/cards.controller.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/cards/cards.tab.js?v=${ASSET_V}`);

        await L.load_script_once(`${PANEL_BASE}/features/enrich/enrich.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/migration/migration.api.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/migration/migration.view.js?v=${ASSET_V}`);
        await L.load_script_once(`${PANEL_BASE}/features/migration/migration.tab.js?v=${ASSET_V}`);

        // ── fix store reinit par référence objet (fix #2) ────────────────
        const current_store = window.hse_store ?? null;
        if (current_store && current_store !== window.__hse_last_store_ref) {
          window.__hse_last_store_ref = current_store;
          if (typeof window.hse_overview_state_init === 'function') window.hse_overview_state_init();
          if (typeof window.hse_diag_state_init     === 'function') window.hse_diag_state_init();
          if (typeof window.hse_config_state_init   === 'function') window.hse_config_state_init();
          console.info('[HSE] store reinit: nouveau hse_store détecté — modules rebranchés');
        }

        this._actions = new window.hse_panel_actions(this);

        // CSS
        const css_parts = await Promise.all([
          L.load_css_text(`${SHARED_BASE}/styles/hse_tokens.shadow.css?v=${ASSET_V}`),
          L.load_css_text(`${SHARED_BASE}/styles/hse_themes.shadow.css?v=${ASSET_V}`),
          L.load_css_text(`${SHARED_BASE}/styles/hse_alias.v2.css?v=${ASSET_V}`),
          L.load_css_text(`${SHARED_BASE}/styles/tokens.css?v=${ASSET_V}`),
          L.load_css_text(`${PANEL_BASE}/features/cards/cards.css?v=${ASSET_V}`),
          L.load_css_text(`${PANEL_BASE}/style.hse.panel.css?v=${ASSET_V}`),
        ]);
        this._css_text = css_parts.join('\n\n');

        // Live service
        window.hse_live_service?.stop?.('overview');
        window.hse_live_service?.start?.(
          'overview',
          (hass) => window.hse_overview_api?.fetch_overview?.(hass),
          30000
        );

        this._boot_done  = true;
        this._boot_error = null;

        this._build_shell();
        this._show_tab(this._active_tab);

      } catch (err) {
        this._boot_error = err?.message || String(err);
        console.error('[HSE] boot error', err);
        this._render_boot_error(this._boot_error);
      } finally {
        this._booting = false;
      }
    }
  }

  // ── Utilitaires locaux ─────────────────────────────────────────────────
  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)        e.className   = cls;
    if (text!=null) e.textContent = text;
    return e;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function boot_and_define() {
    _ensure_loader();
    if (!customElements.get('hse-panel')) {
      customElements.define('hse-panel', HsePanel);
      console.info(`[HSE] hse-panel (single-root) registered (${build_signature})`);
    } else {
      console.info(`[HSE] hse-panel already defined (${build_signature})`);
    }
  }

  if (!window.__hse_boot_started) {
    window.__hse_boot_started = true;
    boot_and_define();
  }

})();
