/* hse_panel.js — Phase 1D (routeur mount-once, vanilla HTMLElement)
   Remplace LitElement par HTMLElement pour éliminer le conflit de mutation
   concurrente sur le shadow DOM (NotSupportedError: The result must not have children).
   Les onglets fils (hse-tab-costs, etc.) conservent leurs implémentations.

   Corrections v1D :
   - FIX1 : style.hse.panel.css ajouté au Promise.all CSS (layout panel manquant)
   - FIX2 : loader inline supprimé — loader.js doit être chargé en premier via hse_panel.html
             => si hse_loader absent au boot, on le bootstrap nous-mêmes SANS écraser le vrai loader
   - FIX3 : _render_nav() stocke data-tab-id sur chaque bouton (plus de recherche par textContent)
   - FIX4 : _switch_tab() utilise data-tab-id pour mettre à jour data-active (robuste)
   - FIX5 : live_service.stop() appelé avant start() pour forcer redémarrage du polling au 2e boot
   - FIX6 : _instance_id initialisé dans le store check plutôt que testé sur propriété absente
   - FIX7 : enrich retiré de NAV_ITEMS_FALLBACK (était filtré mais encore présent, source de confusion)
   - FIX8 : overview.state.js chargé AVANT overview.api.js (dépendance correcte)
*/

const build_signature = "2026-04-05_vanilla_panel_1d";

(function () {
  const PANEL_BASE  = "/api/hse/static/panel";
  const SHARED_BASE = "/api/hse/static/shared";
  const ASSET_V     = "0.1.52";

  // ── Loader Lit (pour les onglets fils qui en ont besoin) ─────────────
  async function _load_lit(url) {
    if (window.LitElement) return;
    const mod = await import(url);
    window.LitElement = mod.LitElement;
    window.html        = mod.html;
    window.css         = mod.css;
    window.nothing     = mod.nothing;
    window.Lit         = mod;
  }

  // FIX2 : bootstrap minimal du loader UNIQUEMENT si loader.js n'a pas été chargé
  // (loader.js doit être chargé en 1er dans hse_panel.html pour que son fix macOS soit actif)
  // Ce fallback ne fait PAS de polling macOS — c'est intentionnel, il est juste fonctionnel.
  function _ensure_loader() {
    if (window.hse_loader) return; // loader.js déjà chargé → on ne touche pas
    const loaded_urls = new Set();
    window.hse_loader = {
      load_script_once: (url) => {
        if (loaded_urls.has(url)) return Promise.resolve();
        return new Promise((resolve, reject) => {
          if (document.querySelector(`script[src="${url}"]`)) {
            loaded_urls.add(url);
            resolve();
            return;
          }
          const s = document.createElement('script');
          s.src = url;
          s.async = true;
          s.onload = () => { loaded_urls.add(url); resolve(); };
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
    console.warn('[HSE] loader.js absent — fallback loader utilisé. Ajoutez loader.js dans hse_panel.html pour le fix macOS.');
  }

  async function boot_and_define() {
    _ensure_loader(); // FIX2

    // Lit reste chargé pour les onglets fils qui en dépendent
    await _load_lit(`${SHARED_BASE}/lib/lit-core.min.js?v=${ASSET_V}`);

    // FIX7 : enrich retiré de NAV_ITEMS_FALLBACK (jamais monté, source de confusion)
    const NAV_ITEMS_FALLBACK = [
      { id: 'overview',   label: 'Accueil' },
      { id: 'diagnostic', label: 'Diagnostic' },
      { id: 'scan',       label: 'Détection' },
      { id: 'config',     label: 'Configuration' },
      { id: 'custom',     label: 'Customisation' },
      { id: 'cards',      label: 'Génération cartes' },
      { id: 'migration',  label: 'Migration capteurs' },
      { id: 'costs',      label: 'Analyse de coûts' },
    ];

    const TAB_ELEMENTS = {
      overview:   'hse-tab-overview',
      costs:      'hse-tab-costs',
      diagnostic: 'hse-tab-diagnostic',
      scan:       'hse-tab-scan',
      migration:  'hse-tab-migration',
      config:     'hse-tab-config',
      custom:     'hse-tab-custom',
      cards:      'hse-tab-cards',
    };

    // ════════════════════════════════════════════════════════════════════
    // HsePanel — vanilla HTMLElement, pas de shadow DOM, pas de Lit
    // Mutations DOM entièrement impératives → aucun conflit possible
    // ════════════════════════════════════════════════════════════════════
    class HsePanel extends HTMLElement {
      constructor() {
        super();
        this._hass_raw    = null;
        this._active_tab  = 'overview';
        this._boot_done   = false;
        this._boot_error  = null;
        this._booting     = false;
        this._theme       = 'ha';
        this._actions     = null;
        this._css_text    = '';

        // Mount-once : { tab_id → HTMLElement }
        this._mounted_tabs = {};

        // Refs DOM internes (construites une seule fois dans _build_shell)
        this._dom = {
          style:   null,
          header:  null,
          tabs:    null,
          content: null,
        };

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

      // ── hass setter — injecté par HA à chaque état ──────────────────
      set hass(hass) {
        this._hass_raw = hass;
        window.hse_live_service?.update_hass?.(hass);
        if (!this._boot_done) {
          if (!this._booting) this._boot();
          return;
        }
        // Propager hass à l'onglet actif monté uniquement
        const active_el = this._mounted_tabs[this._active_tab];
        if (active_el) {
          try { active_el.hass = hass; } catch (_) {}
        }
      }
      get hass() { return this._hass_raw; }

      // ── Cycle de vie ────────────────────────────────────────────────
      connectedCallback() {
        console.info(`[HSE] panel loaded (${build_signature})`);
        window.__hse_panel_loaded = build_signature;

        this._theme = this._storage_get('hse_theme') || 'ha';
        this.setAttribute('data-theme', this._theme);
        this._apply_dynamic_bg_override();
        this._apply_glass_override();

        const saved_tab = this._storage_get('hse_active_tab');
        if (saved_tab) this._active_tab = saved_tab;

        this.addEventListener('mousedown',  () => this._mark_interacting(), true);
        this.addEventListener('focusin',    () => this._mark_interacting(), true);
        this.addEventListener('keydown',    () => this._mark_interacting(), true);
        this.addEventListener('touchstart', () => this._mark_interacting(), { passive: true, capture: true });
        document.addEventListener('mousedown',       this._doc_mousedown, true);
        document.addEventListener('focusin',         this._doc_focusin,   true);
        document.addEventListener('visibilitychange', this._on_visibility_change);

        this._render_loading();
        if (!this._boot_done && !this._booting) this._boot();
      }

      disconnectedCallback() {
        if (this._user_interacting_timer) clearTimeout(this._user_interacting_timer);
        document.removeEventListener('mousedown',       this._doc_mousedown, true);
        document.removeEventListener('focusin',         this._doc_focusin,   true);
        document.removeEventListener('visibilitychange', this._on_visibility_change);
      }

      // ── Rendus d'état ───────────────────────────────────────────────
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

      // ── Shell — construit une seule fois après le boot ───────────────
      _build_shell() {
        this.innerHTML = '';

        // Inject CSS global
        const style = document.createElement('style');
        style.textContent = this._css_text;
        this.appendChild(style);
        this._dom.style = style;

        const page  = _el('div', 'hse_page');
        const shell = _el('div', 'hse_shell');

        // Header
        const header = _el('div', 'hse_header');
        this._dom.header = header;
        shell.appendChild(header);
        this._render_header();

        // Nav tabs
        const tabs = _el('div', 'hse_tabs');
        this._dom.tabs = tabs;
        shell.appendChild(tabs);
        this._render_nav();

        // Content host
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
        sub.textContent = 'Panel v2 (modulaire)';
        left.appendChild(h1);
        left.appendChild(sub);
        const right = _el('div', 'hse_subtitle');
        right.textContent = `user: ${user}`;
        el.appendChild(left);
        el.appendChild(right);
      }

      // FIX3 : stocke data-tab-id sur chaque bouton au lieu de se fier au textContent
      _render_nav() {
        const el = this._dom.tabs;
        if (!el) return;
        const items = this._get_nav_items();
        el.innerHTML = '';
        for (const item of items) {
          const btn = _el('button', 'hse_tab');
          btn.textContent       = item.label;
          btn.dataset.tabId     = item.id;            // FIX3
          btn.dataset.active    = item.id === this._active_tab ? 'true' : 'false';
          btn.addEventListener('click', () => this._switch_tab(item.id));
          el.appendChild(btn);
        }
      }

      // ── Routeur mount-once ──────────────────────────────────────────
      // FIX4 : utilise data-tab-id pour mettre à jour data-active (plus de recherche textContent)
      _switch_tab(tab_id) {
        if (tab_id === this._active_tab) return;

        if (this._dom.tabs) {
          for (const btn of this._dom.tabs.querySelectorAll('.hse_tab')) {
            btn.dataset.active = btn.dataset.tabId === tab_id ? 'true' : 'false'; // FIX4
          }
        }

        this._active_tab = tab_id;
        this._storage_set('hse_active_tab', tab_id);

        if (this._hass_raw) window.hse_live_service?.update_hass?.(this._hass_raw);

        if (this._dom.content) {
          this._dom.content.dataset.tab = tab_id;
          this._ensure_tab_mounted(this._dom.content, tab_id);
        }
      }

      _ensure_tab_mounted(content, tab_id) {
        if (!content) return;

        // Masquer tous les onglets sauf la cible
        for (const [id, el] of Object.entries(this._mounted_tabs)) {
          if (!el) continue;
          el.style.display = id === tab_id ? 'block' : 'none';
        }

        // Déjà monté → maj hass/panel + afficher
        const existing = this._mounted_tabs[tab_id];
        if (existing) {
          existing.style.display = 'block';
          try { existing.hass  = this._hass_raw; } catch (_) {}
          try { existing.panel = this.panel;      } catch (_) {}
          return;
        }

        const tag_name = TAB_ELEMENTS[tab_id];
        if (tag_name && customElements.get(tag_name)) {
          const tab_el = document.createElement(tag_name);
          tab_el.style.display = 'block';
          try { tab_el.hass  = this._hass_raw; } catch (_) {}
          try { tab_el.panel = this.panel;      } catch (_) {}
          content.appendChild(tab_el);
          this._mounted_tabs[tab_id] = tab_el;
          return;
        }

        // Fallback legacy overview
        if (tab_id === 'overview' && window.hse_overview_view?.render_overview) {
          const wrapper = _el('div', 'hse_page');
          wrapper.style.display = 'block';
          content.appendChild(wrapper);
          this._mounted_tabs[tab_id] = wrapper;
          window.hse_overview_view.render_overview(wrapper, this._hass_raw, this._hass_raw);
          return;
        }

        // Placeholder générique
        const wrapper = _el('div');
        wrapper.style.display = 'block';
        wrapper.textContent = `Onglet "${tab_id}" non implémenté`;
        content.appendChild(wrapper);
        this._mounted_tabs[tab_id] = wrapper;
      }

      // ── Navigation ──────────────────────────────────────────────────
      _get_nav_items() {
        const from_shell = window.hse_shell?.get_nav_items?.();
        const items = Array.isArray(from_shell) && from_shell.length ? from_shell : NAV_ITEMS_FALLBACK;
        // FIX7 : enrich toujours filtré même s'il revient via shell.js
        return items.filter(x => x && x.id !== 'enrich');
      }

      _set_active_tab(tab_id) {
        this._switch_tab(tab_id);
      }

      // ── Theme ───────────────────────────────────────────────────────
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
        const val = (this._storage_get('hse_custom_glass') || '0') === '1' ? 'blur(18px) saturate(160%)' : '';
        this.style.setProperty('--hse-backdrop-filter', val);
      }

      // ── Interaction guard ───────────────────────────────────────────
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

      // ── Helpers storage ─────────────────────────────────────────────
      _storage_get(key) {
        try { return window.localStorage.getItem(key); } catch (_) { return null; }
      }
      _storage_set(key, v) {
        try { window.localStorage.setItem(key, v); } catch (_) {}
      }

      // ── Boot ────────────────────────────────────────────────────────
      async _boot() {
        if (this._boot_done || this._booting) return;
        this._booting = true;
        try {
          const L = window.hse_loader;

          // Shared
          await L.load_script_once(`${SHARED_BASE}/ui/dom.js?v=${ASSET_V}`);
          await L.load_script_once(`${SHARED_BASE}/ui/table.js?v=${ASSET_V}`);
          await L.load_script_once(`${SHARED_BASE}/hse.store.js?v=${ASSET_V}`);
          await L.load_script_once(`${SHARED_BASE}/hse.fetch.js?v=${ASSET_V}`);

          // Core states (avant les views qui en dépendent)
          await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diag.state.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/config/config.state.js?v=${ASSET_V}`);

          // Core services
          await L.load_script_once(`${PANEL_BASE}/core/shell.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/core/panel.actions.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/core/live.store.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/core/live.service.js?v=${ASSET_V}`);

          // Costs
          await L.load_script_once(`${PANEL_BASE}/features/costs/costs.tab.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/costs/costs.view.js?v=${ASSET_V}`);

          // Overview (FIX8 : state avant api avant view avant tab)
          await L.load_script_once(`${PANEL_BASE}/features/overview/overview.state.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/overview/overview.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/overview/overview.view.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/overview/overview.tab.js?v=${ASSET_V}`);

          // Scan
          await L.load_script_once(`${PANEL_BASE}/features/scan/scan.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/scan/scan.view.js?v=${ASSET_V}`);

          // Custom / Diagnostic / Enrich / Migration / Config / Cards
          await L.load_script_once(`${PANEL_BASE}/features/custom/custom.view.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/diagnostic/diagnostic.view.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/enrich/enrich.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/migration/migration.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/migration/migration.view.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/config/config.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/config/config.view.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/cards/cards.api.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/cards/logic/yamlComposer.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/cards/cards.view.js?v=${ASSET_V}`);
          await L.load_script_once(`${PANEL_BASE}/features/cards/cards.controller.js?v=${ASSET_V}`);

          // FIX6 : reinit store — on teste _instance_id proprement
          if (!window.hse_store?._instance_id) {
            if (window.hse_store) window.hse_store._instance_id = Date.now();
          }
          if (window.hse_store?._instance_id !== window.__hse_last_store_id) {
            window.__hse_last_store_id = window.hse_store._instance_id;
            if (typeof window.hse_overview_state_init === 'function') window.hse_overview_state_init();
            if (typeof window.hse_diag_state_init    === 'function') window.hse_diag_state_init();
            if (typeof window.hse_config_state_init  === 'function') window.hse_config_state_init();
            console.info('[HSE] store reinit: modules rebranches sur nouveau hse_store');
          }

          this._actions = new window.hse_panel_actions(this);

          // FIX1 : style.hse.panel.css ajouté (layout du panel)
          const css_parts = await Promise.all([
            L.load_css_text(`${SHARED_BASE}/styles/hse_tokens.shadow.css?v=${ASSET_V}`),
            L.load_css_text(`${SHARED_BASE}/styles/hse_themes.shadow.css?v=${ASSET_V}`),
            L.load_css_text(`${SHARED_BASE}/styles/hse_alias.v2.css?v=${ASSET_V}`),
            L.load_css_text(`${SHARED_BASE}/styles/tokens.css?v=${ASSET_V}`),
            L.load_css_text(`${PANEL_BASE}/features/cards/cards.css?v=${ASSET_V}`),
            L.load_css_text(`${PANEL_BASE}/style.hse.panel.css?v=${ASSET_V}`),  // FIX1
          ]);
          this._css_text = css_parts.join('\n\n');

          // FIX5 : stop() avant start() pour forcer redémarrage propre au 2e boot
          window.hse_live_service?.stop?.('overview');
          window.hse_live_service.start(
            'overview',
            (hass) => window.hse_overview_api.fetch_overview(hass),
            30000
          );

          this._boot_done  = true;
          this._boot_error = null;

          // Construire le shell DOM une seule fois maintenant que tout est prêt
          this._build_shell();

          // Monter l'onglet actif initial
          this._ensure_tab_mounted(this._dom.content, this._active_tab);

        } catch (err) {
          this._boot_error = err?.message || String(err);
          console.error('[HSE] boot error', err);
          this._render_boot_error(this._boot_error);
        } finally {
          this._booting = false;
        }
      }
    }

    // ── Utilitaires locaux ───────────────────────────────────────────────
    function _el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls)       e.className   = cls;
      if (text!=null) e.textContent = text;
      return e;
    }

    function _esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    if (!customElements.get('hse-panel')) {
      customElements.define('hse-panel', HsePanel);
      console.info(`[HSE] hse-panel (vanilla) registered (${build_signature})`);
    } else {
      console.info(`[HSE] hse-panel already defined, skipping (${build_signature})`);
    }
  }

  if (!window.__hse_boot_started) {
    window.__hse_boot_started = true;
    boot_and_define().catch(err => console.error('[HSE] boot_and_define failed', err));
  }

})();