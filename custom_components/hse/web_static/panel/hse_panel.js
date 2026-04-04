/* entrypoint - hse_panel.js — Phase 1C (routeur mount-once) */
const build_signature = "2026-04-04_shell_mount_once_final";

(function () {
  const PANEL_BASE  = "/api/hse/static/panel";
  const SHARED_BASE = "/api/hse/static/shared";
  const ASSET_V     = "0.1.52";

  async function _load_lit(url) {
    if (window.LitElement) return;
    const mod = await import(url);
    window.LitElement = mod.LitElement;
    window.html       = mod.html;
    window.css        = mod.css;
    window.nothing    = mod.nothing;
    window.Lit        = mod;
  }

  async function boot_and_define() {

    if (!window.hse_loader) {
      window.hse_loader = {
        load_script_once: (url) =>
          new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
            const s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = resolve;
            s.onerror = () => reject(new Error(`script_load_failed: ${url}`));
            document.head.appendChild(s);
          }),
        load_css_text: async (url) => {
          const resp = await fetch(url, { cache: 'no-store' });
          if (!resp.ok) throw new Error(`css_load_failed: ${url} (${resp.status})`);
          return resp.text();
        },
      };
    }

    await _load_lit(`${SHARED_BASE}/lib/lit-core.min.js?v=${ASSET_V}`);
    const { LitElement, html, css, nothing } = window.Lit;

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

    // Mapping tab_id → nom du custom element
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

    class HsePanel extends LitElement {

      static get properties() {
        return {
          hass:         { attribute: false },
          _active_tab:  { state: true },
          _boot_done:   { state: true },
          _boot_error:  { state: true },
          _theme:       { state: true },
        };
      }

      constructor() {
        super();

        this._active_tab  = 'overview';
        this._boot_done   = false;
        this._boot_error  = null;
        this._theme       = 'ha';

        this._hass_raw    = null;
        this._actions     = null;

        // Mount-once : map des composants montés { tab_id → element }
        this._mounted_tabs = {};

        this._doc_mousedown = () => this._mark_interacting();
        this._doc_focusin   = (e) => {
          if (this.shadowRoot && e.composedPath?.().some(n => n === this.shadowRoot))
            this._mark_interacting();
        };

        // ── FIX bureau virtuel : visibilitychange ─────────────────────────
        this._on_visibility_change = () => {
          if (document.visibilityState !== 'visible' || !this._boot_done) return;
          let _attempts = 0;
          const _poll = () => {
            const ha = document.querySelector('home-assistant');
            const fresh = ha?.hass;
            if (fresh) {
              this.hass = fresh;
              this.requestUpdate();
              return;
            }
            if (++_attempts < 20) setTimeout(_poll, 500);
            else this.requestUpdate();
          };
          _poll();
        };
      }

      // ── set hass — injecté par HA à chaque état ───────────────────────
      set hass(hass) {
        this._hass_raw = hass;

        // Propager hass au service live
        window.hse_live_service?.update_hass?.(hass);

        const shadow = this.shadowRoot;
        if (shadow && !shadow.querySelector('.hse_page') && this._boot_done) {
          this.requestUpdate();
          return;
        }

        if (!this._boot_done) {
          if (!this._booting) this._boot();
          this.requestUpdate();
          return;
        }

        // Propager hass uniquement à l'onglet actif monté
        const active_el = this._mounted_tabs[this._active_tab];
        if (active_el) {
          try { active_el.hass = hass; } catch (_) {}
        }

        this.requestUpdate();
      }

      get hass() { return this._hass_raw; }

      // ── Cycle de vie ─────────────────────────────────────────────────
      connectedCallback() {
        super.connectedCallback();
        console.info(`[HSE] panel loaded (${build_signature})`);
        window.__hse_panel_loaded = build_signature;

        this._theme = this._storage_get('hse_theme') || 'ha';
        this.setAttribute('data-theme', this._theme);
        this._apply_dynamic_bg_override();
        this._apply_glass_override();

        const saved_tab = this._storage_get('hse_active_tab');
        if (saved_tab) this._active_tab = saved_tab;

        this.shadowRoot.addEventListener('mousedown', () => this._mark_interacting(), true);
        this.shadowRoot.addEventListener('focusin',   () => this._mark_interacting(), true);
        this.shadowRoot.addEventListener('keydown',   () => this._mark_interacting(), true);
        this.shadowRoot.addEventListener('touchstart',() => this._mark_interacting(), { passive: true, capture: true });

        document.addEventListener('mousedown',        this._doc_mousedown,         true);
        document.addEventListener('focusin',          this._doc_focusin,           true);
        document.addEventListener('visibilitychange', this._on_visibility_change);

        if (this._boot_done) {
          this.requestUpdate();
          return;
        }

        this._boot();
      }

      disconnectedCallback() {
        super.disconnectedCallback();
        if (this._user_interacting_timer) clearTimeout(this._user_interacting_timer);
        document.removeEventListener('mousedown',        this._doc_mousedown,         true);
        document.removeEventListener('focusin',          this._doc_focusin,           true);
        document.removeEventListener('visibilitychange', this._on_visibility_change);
      }

      static get styles() { return css``; }

      render() {
        if (!this._boot_done) {
          if (this._boot_error) {
            return html`<style>:host{display:block;padding:16px;font-family:system-ui;color:var(--primary-text-color);}pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.2);padding:12px;border-radius:10px;}</style>
              <div>
                <div style="font-size:18px">Home Suivi Elec</div>
                <div style="opacity:.8">Boot error</div>
                <pre>${this._boot_error}</pre>
              </div>`;
          }
          return html`<div style="padding:16px;opacity:.6">Chargement HSE…</div>`;
        }

        if (!this._hass_raw) {
          return html`${this._style_tag()}
            <div class="hse_page"><div class="hse_shell">
              <div class="hse_card">En attente de hass…</div>
            </div></div>`;
        }

        return html`${this._style_tag()}
          <div class="hse_page">
            <div class="hse_shell">
              ${this._render_header()}
              ${this._render_tabs()}
              <div id="hse-content" data-tab="${this._active_tab}">
              </div>
            </div>
          </div>`;
      }

      _render_header() {
        const user = this._hass_raw?.user?.name || '—';
        return html`
          <div class="hse_header">
            <div>
              <h1 class="hse_title">Home Suivi Elec</h1>
              <div class="hse_subtitle">Panel v2 (modulaire)</div>
            </div>
            <div class="hse_subtitle">user: ${user}</div>
          </div>`;
      }

      _render_tabs() {
        const items = this._get_nav_items();
        return html`
          <div class="hse_tabs">
            ${items.map(it => html`
              <button
                class="hse_tab"
                data-active="${it.id === this._active_tab ? 'true' : 'false'}"
                @click=${() => this._switch_tab(it.id)}>
                ${it.label}
              </button>`)}
          </div>`;
      }

      updated(changed) {
        if (!this._boot_done || !this._hass_raw) return;
        const content = this.shadowRoot?.querySelector('#hse-content');
        if (!content) return;
        // Monter / afficher l'onglet actif via le routeur mount-once
        this._ensure_tab_mounted(content, this._active_tab);
      }

      // ── Routeur mount-once ────────────────────────────────────────────

      /**
       * _switch_tab(tab_id)
       * Masque l'onglet actuel, affiche (ou monte si première fois) le nouvel onglet.
       */
      _switch_tab(tab_id) {
        if (tab_id === this._active_tab) return;
        this._active_tab = tab_id;
        this._storage_set('hse_active_tab', tab_id);
        // Propager hass au service live
        if (this._hass_raw) window.hse_live_service?.update_hass?.(this._hass_raw);
        const content = this.shadowRoot?.querySelector('#hse-content');
        if (content) this._ensure_tab_mounted(content, tab_id);
        this.requestUpdate();
      }

      /**
       * _ensure_tab_mounted(content, tab_id)
       * Monte le composant si premier accès, sinon juste display:block.
       * Cache tous les autres onglets (display:none).
       * Si le custom element n'est pas encore défini, affiche un placeholder minimal.
       */
      _ensure_tab_mounted(content, tab_id) {
        // Cacher tous les onglets montés sauf la cible
        for (const [id, el] of Object.entries(this._mounted_tabs)) {
          el.style.display = id === tab_id ? 'block' : 'none';
        }

        if (this._mounted_tabs[tab_id]) {
          // Déjà monté — juste propager hass
          try { this._mounted_tabs[tab_id].hass = this._hass_raw; } catch (_) {}
          return;
        }

        // Première fois — tenter de créer le custom element
        const tag_name = TAB_ELEMENTS[tab_id];
        if (tag_name && customElements.get(tag_name)) {
          const tab_el = document.createElement(tag_name);
          tab_el.style.display = 'block';
          try { tab_el.hass = this._hass_raw; } catch (_) {}
          if (this.panel) try { tab_el.panel = this.panel; } catch (_) {}
          content.appendChild(tab_el);
          this._mounted_tabs[tab_id] = tab_el;
          return;
        }

        // Custom element non encore disponible — placeholder minimal (mount-once)
        const wrapper = this._tab_placeholder_element(tab_id);
        wrapper.style.display = 'block';
        content.appendChild(wrapper);
        this._mounted_tabs[tab_id] = wrapper;
      }

      // ── Placeholder minimal (aucun fallback legacy) ───────────────────

      /**
       * _tab_placeholder_element(tab_id)
       * Crée un wrapper unique avec un message « non chargé ».
       * Ne jamais rerendre tout le panel depuis ici.
       */
      _tab_placeholder_element(tab_id) {
        const nav = NAV_ITEMS_FALLBACK.find(x => x.id === tab_id);
        const label = nav?.label || tab_id;
        const wrapper = document.createElement('div');
        wrapper.dataset.hseTabPlaceholder = tab_id;
        if (window.hse_dom?.el) {
          const { el } = window.hse_dom;
          const card = el('div', 'hse_card');
          card.appendChild(el('div', null, label));
          card.appendChild(el('div', 'hse_subtitle', `${label} non chargé`));
          wrapper.appendChild(card);
        } else {
          wrapper.innerHTML = `<div style="padding:16px;opacity:.7">${label} non chargé</div>`;
        }
        return wrapper;
      }

      _render_error(content, ctx, err) {
        console.error(`[HSE] UI error in ${ctx}`, err);
        if (!content) return;
        if (window.hse_dom?.el) {
          const { el } = window.hse_dom;
          content.innerHTML = '';
          const card = el('div', 'hse_card');
          card.appendChild(el('div', null, `Erreur UI: ${ctx}`));
          card.appendChild(el('pre', 'hse_code', String(err?.message || err)));
          content.appendChild(card);
        } else {
          content.innerHTML = `<div style="padding:16px;color:red">Erreur UI: ${ctx}<br><pre>${String(err?.message || err)}</pre></div>`;
        }
      }

      // ── Navigation ────────────────────────────────────────────────────
      _get_nav_items() {
        const from_shell = window.hse_shell?.get_nav_items?.();
        const items = Array.isArray(from_shell) && from_shell.length ? from_shell : NAV_ITEMS_FALLBACK;
        return items.filter(x => x && x.id !== 'enrich');
      }

      // Conservé pour compatibilité externe éventuelle
      _set_active_tab(tab_id) {
        this._switch_tab(tab_id);
      }

      // ── Theme ─────────────────────────────────────────────────────────
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

      // ── Interaction guard ─────────────────────────────────────────────
      _mark_interacting() {
        this._user_interacting = true;
        if (this._user_interacting_timer) clearTimeout(this._user_interacting_timer);
        const schedule = () => {
          this._user_interacting_timer = setTimeout(() => {
            const a = document.activeElement;
            if (a?.tagName === 'SELECT') { schedule(); return; }
            const sa = this.shadowRoot?.activeElement;
            if (sa?.tagName === 'SELECT') { schedule(); return; }
            this._user_interacting = false;
            this._user_interacting_timer = null;
            this.requestUpdate();
          }, 2000);
        };
        schedule();
      }

      // ── Helpers storage ───────────────────────────────────────────────
      _storage_get(key) { try { return window.localStorage.getItem(key); } catch (_) { return null; } }
      _storage_set(key, v) { try { window.localStorage.setItem(key, v); } catch (_) {} }

      // ── Style tag ─────────────────────────────────────────────────────
      _style_tag() {
        return this._css_text
          ? html`<style>${this._css_text}</style>`
          : nothing;
      }

      // ── Boot ──────────────────────────────────────────────────────────
      async _boot() {
        if (this._boot_done || this._booting) return;
        this._booting = true;
        try {
          await window.hse_loader.load_script_once(`${SHARED_BASE}/ui/dom.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${SHARED_BASE}/ui/table.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${SHARED_BASE}/hse.store.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${SHARED_BASE}/hse.fetch.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/diagnostic/diag.state.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/config/config.state.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/core/shell.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/core/panel.actions.js?v=${ASSET_V}`);
          // ── Phase 1 : live store & service ──
          await window.hse_loader.load_script_once(`${PANEL_BASE}/core/live.store.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/core/live.service.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/costs/costs.tab.js?v=${ASSET_V}`);
          // ── Features ──
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/overview/overview.api.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/overview/overview.state.js?v=${ASSET_V}`);
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
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/cards/cards.api.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/cards/logic/yamlComposer.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/cards/cards.view.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/cards/cards.controller.js?v=${ASSET_V}`);

          const _store_id = window.hse_store?._instance_id;
          if (!_store_id || _store_id !== window.__hse_last_store_id) {
            if (window.hse_store) {
              window.hse_store._instance_id = Date.now();
              window.__hse_last_store_id = window.hse_store._instance_id;
            }
            if (typeof window.hse_overview_state_init === 'function') window.hse_overview_state_init();
            if (typeof window.hse_diag_state_init     === 'function') window.hse_diag_state_init();
            if (typeof window.hse_config_state_init   === 'function') window.hse_config_state_init();
            console.info('[HSE] store reinit: modules rebranches sur nouveau hse_store');
          }

          this._actions = new window.hse_panel_actions(this);

          const css_parts = await Promise.all([
            window.hse_loader.load_css_text(`${SHARED_BASE}/styles/hse_tokens.shadow.css?v=${ASSET_V}`),
            window.hse_loader.load_css_text(`${SHARED_BASE}/styles/hse_themes.shadow.css?v=${ASSET_V}`),
            window.hse_loader.load_css_text(`${SHARED_BASE}/styles/hse_alias.v2.css?v=${ASSET_V}`),
            window.hse_loader.load_css_text(`${SHARED_BASE}/styles/tokens.css?v=${ASSET_V}`),
            window.hse_loader.load_css_text(`${PANEL_BASE}/features/cards/cards.css?v=${ASSET_V}`),
          ]);
          this._css_text = css_parts.join('\n\n');

          // ── Démarrer le polling overview via live.service ──
          window.hse_live_service.start(
            'overview',
            (hass) => window.hse_overview_api.fetch_overview(hass),
            30000
          );

          this._boot_done  = true;
          this._boot_error = null;
          this.requestUpdate();
        } catch (err) {
          this._boot_error = err?.message || String(err);
          console.error('[HSE] boot error', err);
          this.requestUpdate();
        } finally {
          this._booting = false;
        }
      }
    }

    if (!customElements.get('hse-panel')) {
      customElements.define('hse-panel', HsePanel);
      console.info(`[HSE] hse-panel (Lit) registered (${build_signature})`);
    } else {
      console.info(`[HSE] hse-panel already defined, skipping (${build_signature})`);
    }
  }

  if (!window.__hse_boot_started) {
    window.__hse_boot_started = true;
    boot_and_define().catch(err => console.error('[HSE] boot_and_define failed', err));
  }

})();
