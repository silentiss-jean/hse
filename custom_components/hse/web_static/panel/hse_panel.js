/* entrypoint - hse_panel.js — phase 11 (LitElement) */
const build_signature = "2026-03-25_phase11_lit_fix_stale";

(function () {
  const PANEL_BASE  = "/api/hse/static/panel";
  const SHARED_BASE = "/api/hse/static/shared";
  const ASSET_V     = "0.1.42";

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

    // ── Onglets stables (DOM préservé entre set hass) ─────────────────────
    const TABS_STABLE = new Set(['cards','custom','config','costs','diagnostic','scan','migration']);

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

    class HsePanel extends LitElement {

      // ── Propriétés réactives Lit ────────────────────────────────────────
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

        this._overview_timer      = null;
        this._overview_refreshing = false;
        this._overview_data       = null;
        this._overview_built      = false;

        this._scan_result = { integrations: [], candidates: [] };
        this._scan_state  = {
          scan_running: false, filter_q: '', groups_open: {}, open_all: false,
        };

        this._migration_state = { loading: false, error: null, last: null, active_yaml: '' };

        this._custom_state = { theme: 'ha', dynamic_bg: true, glass: false };

        this._reference_status_timer            = null;
        this._reference_status_polling          = false;
        this._reference_status_target_entity_id = undefined;

        this._user_interacting       = false;
        this._user_interacting_timer = null;

        this._org_state = {
          get loading()     { return !!window.hse_store?.get('org.loading'); },
          set loading(v)    { window.hse_store?.set('org.loading', !!v); },
          get saving()      { return !!window.hse_store?.get('org.saving'); },
          set saving(v)     { window.hse_store?.set('org.saving', !!v); },
          get dirty()       { return !!window.hse_store?.get('org.dirty'); },
          set dirty(v)      { window.hse_store?.set('org.dirty', !!v); },
          get error()       { return window.hse_store?.get('org.error') ?? null; },
          set error(v)      { window.hse_store?.set('org.error', v ?? null); },
          get message()     { return window.hse_store?.get('org.message') ?? null; },
          set message(v)    { window.hse_store?.set('org.message', v ?? null); },
          get meta_store()  { return window.hse_store?.get('org.meta_store') ?? null; },
          set meta_store(v) { window.hse_store?.set('org.meta_store', v); },
          get meta_draft()  { return window.hse_store?.get('org.meta_draft') ?? null; },
          set meta_draft(v) { window.hse_store?.set('org.meta_draft', v); },
          preview_running: false, apply_running: false,
          show_raw: false, rooms_filter_q: '', assignments_filter_q: '',
        };

        this._diag_state = new Proxy({}, {
          get(_, k) { const s = window.hse_diag_state; return s ? s.get(k) : undefined; },
          set(_, k, v) { const s = window.hse_diag_state; if (s) s.set(k, v); return true; },
        });

        this._config_state = new Proxy({}, {
          get(_, k) { const s = window.hse_config_state; return s ? s.get(k) : undefined; },
          set(_, k, v) { const s = window.hse_config_state; if (s) s.set(k, v); return true; },
        });

        this._doc_mousedown = () => this._mark_interacting();
        this._doc_focusin   = (e) => {
          if (this.shadowRoot && e.composedPath?.().some(n => n === this.shadowRoot))
            this._mark_interacting();
        };
      }

      // ── set hass — injecté par HA à chaque état ───────────────────────
      set hass(hass) {
        this._hass_raw = hass;
        window.hse_overview_state?.update_hass?.(hass);

        const shadow = this.shadowRoot;
        if (shadow && !shadow.querySelector('.hse_page') && this._boot_done) {
          this.requestUpdate();
          return;
        }

        if (!this._boot_done) {
          if (!this._booting) this._boot();
          return;
        }

        if (TABS_STABLE.has(this._active_tab)) {
          this.requestUpdate();
          return;
        }

        if (this._active_tab === 'overview') {
          const body = shadow?.querySelector('[data-hse-overview-body]');
          if (this._overview_built && body?.isConnected) {
            this.requestUpdate();
            return;
          }
          this._overview_built = false;
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
        this._custom_state.theme = this._theme;
        this._custom_state.dynamic_bg = (this._storage_get('hse_custom_dynamic_bg') || '1') === '1';
        this._custom_state.glass      = (this._storage_get('hse_custom_glass')      || '0') === '1';
        this.setAttribute('data-theme', this._theme);
        this._apply_dynamic_bg_override();
        this._apply_glass_override();

        const saved_tab = this._storage_get('hse_active_tab');
        if (saved_tab) this._active_tab = saved_tab;

        try {
          const raw = this._storage_get('hse_scan_groups_open');
          if (raw) this._scan_state.groups_open = JSON.parse(raw) || {};
        } catch (_) {}
        this._scan_state.open_all = (this._storage_get('hse_scan_open_all') || '0') === '1';

        this.shadowRoot.addEventListener('mousedown', () => this._mark_interacting(), true);
        this.shadowRoot.addEventListener('focusin',   () => this._mark_interacting(), true);
        this.shadowRoot.addEventListener('keydown',   () => this._mark_interacting(), true);
        this.shadowRoot.addEventListener('touchstart',() => this._mark_interacting(), { passive: true, capture: true });

        document.addEventListener('mousedown', this._doc_mousedown, true);
        document.addEventListener('focusin',   this._doc_focusin,   true);

        // Retour bureau virtuel : l'instance existe déjà, on reset l'état
        // overview pour forcer un rebuild propre au prochain render
        if (this._boot_done) {
          this._overview_built = false;
          window.hse_overview_state?.register_container?.(null, null);
          this.requestUpdate();
          return;
        }

        this._boot();
      }

      disconnectedCallback() {
        super.disconnectedCallback();
        this._clear_overview_autorefresh();
        this._clear_reference_status_polling();
        if (this._user_interacting_timer) clearTimeout(this._user_interacting_timer);
        document.removeEventListener('mousedown', this._doc_mousedown, true);
        document.removeEventListener('focusin',   this._doc_focusin,   true);
        // Invalide le container dans overview.state pour éviter les patch_live
        // sur un DOM détaché pendant l'absence du panel
        window.hse_overview_state?.register_container?.(null, null);
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
                ${this._render_tab_content()}
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
                @click=${() => this._set_active_tab(it.id)}>
                ${it.label}
              </button>`)}
          </div>`;
      }

      _render_tab_content() {
        return nothing;
      }

      updated(changed) {
        if (this._active_tab !== 'overview' && this._active_tab !== 'costs') {
          this._clear_overview_autorefresh();
        }
        if (this._active_tab !== 'config') {
          this._clear_reference_status_polling();
        }

        const content = this.shadowRoot?.querySelector('#hse-content');
        if (!content || !this._boot_done || !this._hass_raw) return;

        this._dispatch_tab(content);
      }

      _dispatch_tab(content) {
        try {
          switch (this._active_tab) {
            case 'overview':   this._tab_overview(content);   break;
            case 'costs':      this._tab_costs(content);      break;
            case 'diagnostic': this._tab_diagnostic(content); break;
            case 'scan':       this._tab_scan(content);       break;
            case 'migration':  this._tab_migration(content);  break;
            case 'config':     this._tab_config(content);     break;
            case 'custom':     this._tab_custom(content);     break;
            case 'cards':      this._tab_cards(content);      break;
            default:           this._tab_placeholder(content, 'Page', 'À venir.');
          }
        } catch (err) {
          this._render_error(content, 'dispatch_tab', err);
        }
      }

      // ── Onglet Overview ───────────────────────────────────────────────
      _tab_overview(content) {
        this._ensure_overview_autorefresh();

        let body = content.querySelector('[data-hse-overview-body]');
        if (!body) {
          // Nouveau DOM : reset complet du flag built
          this._overview_built = false;
          const { el } = window.hse_dom;
          content.innerHTML = '';
          const card    = el('div', 'hse_card');
          const toolbar = el('div', 'hse_toolbar');
          const btn     = el('button', 'hse_button hse_button_primary', 'Rafraîchir');
          btn.addEventListener('click', () => this._overview_force_refresh(content));
          toolbar.appendChild(btn);
          card.appendChild(toolbar);
          body = el('div');
          body.dataset.hseOverviewBody = '1';
          content.appendChild(card);
          content.appendChild(body);
        }

        // Enregistre toujours le body courant — overview.state vérifiera isConnected
        window.hse_overview_state?.register_container?.(body, this._hass_raw);

        if (this._overview_built) return; // patch_live gère les updates

        const data = window.hse_overview_state?.get('data') ?? this._overview_data;
        if (!data) {
          body.innerHTML = '';
          body.appendChild(window.hse_dom.el('div', 'hse_subtitle', 'Chargement…'));
          return;
        }
        if (data.error) {
          body.innerHTML = '';
          const c = window.hse_dom.el('div', 'hse_card');
          c.appendChild(window.hse_dom.el('div', null, 'Erreur'));
          c.appendChild(window.hse_dom.el('pre', 'hse_code', String(data.error)));
          body.appendChild(c);
          return;
        }

        // Rebuild complet
        body.innerHTML = '';
        window.hse_overview_view.render_overview(body, data, this._hass_raw);
        this._overview_built = true;
        // Marque aussi dans overview.state pour que patch_live soit autorisé
        window.hse_overview_state?.mark_built?.();
      }

      async _overview_force_refresh(content) {
        this._overview_built = false;
        this._overview_data  = null;
        window.hse_overview_state?.begin_fetch?.();
        this.requestUpdate();
        try {
          const fn = window.hse_overview_api?.fetch_overview || window.hse_overview_api?.fetch_manifest_and_ping;
          if (!fn) throw new Error('overview_api_not_loaded');
          const data = await fn(this._hass_raw);
          this._overview_data = data;
          const body = content.querySelector('[data-hse-overview-body]');
          window.hse_overview_state?.end_fetch?.(data, this._hass_raw, body ?? null);
        } catch (err) {
          const d = { error: this._actions?._err_msg(err) || String(err) };
          this._overview_data = d;
          const body = content.querySelector('[data-hse-overview-body]');
          window.hse_overview_state?.end_fetch?.(d, this._hass_raw, body ?? null);
        }
        this.requestUpdate();
      }

      // ── Onglet Costs ──────────────────────────────────────────────────
      _tab_costs(content) {
        this._ensure_overview_autorefresh();
        const { el } = window.hse_dom;

        let body = content.querySelector('[data-hse-costs-body]');
        if (!body) {
          content.innerHTML = '';
          const card    = el('div', 'hse_card');
          const toolbar = el('div', 'hse_toolbar');
          const btn     = el('button', 'hse_button hse_button_primary', 'Rafraîchir');
          btn.addEventListener('click', async () => {
            this._overview_data = null;
            window.hse_overview_state?.begin_fetch?.();
            this.requestUpdate();
            try {
              const fn = window.hse_overview_api?.fetch_overview || window.hse_overview_api?.fetch_manifest_and_ping;
              const data = await fn(this._hass_raw);
              this._overview_data = data;
              window.hse_overview_state?.end_fetch?.(data, this._hass_raw, null);
            } catch (err) {
              const d = { error: String(err) };
              this._overview_data = d;
              window.hse_overview_state?.end_fetch?.(d, this._hass_raw, null);
            }
            this.requestUpdate();
          });
          toolbar.appendChild(btn);
          card.appendChild(toolbar);
          body = el('div');
          body.dataset.hseCostsBody = '1';
          content.appendChild(card);
          content.appendChild(body);
        }

        const data = window.hse_overview_state?.get('data') ?? this._overview_data;
        body.innerHTML = '';
        if (!data) { body.appendChild(el('div', 'hse_subtitle', 'Chargement…')); return; }
        if (data.error) {
          const c = el('div', 'hse_card');
          c.appendChild(el('div', null, 'Erreur'));
          c.appendChild(el('pre', 'hse_code', String(data.error)));
          body.appendChild(c); return;
        }
        if (!window.hse_costs_view?.render_costs) {
          this._tab_placeholder(body, 'Analyse de coûts', 'costs.view.js non chargé.'); return;
        }
        window.hse_costs_view.render_costs(body, data, this._hass_raw);
      }

      // ── Onglet Scan ───────────────────────────────────────────────────
      _tab_scan(content) {
        if (!window.hse_scan_view) {
          this._tab_placeholder(content, 'Détection', 'scan.view.js non chargé.'); return;
        }
        content.innerHTML = '';
        window.hse_scan_view.render_scan(content, this._scan_result, this._scan_state, async (action, value) => {
          if (action === 'filter') { this._scan_state.filter_q = value || ''; this.requestUpdate(); return; }
          if (action === 'set_group_open') {
            const { id, open, no_render } = value || {};
            if (id) { this._scan_state.groups_open[id] = !!open; this._storage_set('hse_scan_groups_open', JSON.stringify(this._scan_state.groups_open)); }
            if (!no_render) this.requestUpdate();
            return;
          }
          if (action === 'open_all')  { this._scan_state.open_all = true;  this._storage_set('hse_scan_open_all', '1'); this.requestUpdate(); return; }
          if (action === 'close_all') { this._scan_state.open_all = false; this._scan_state.groups_open = {}; this._storage_set('hse_scan_open_all', '0'); this._storage_set('hse_scan_groups_open', '{}'); this.requestUpdate(); return; }
          if (action === 'scan') {
            this._scan_state.scan_running = true;
            this.requestUpdate();
            try { this._scan_result = await window.hse_scan_api.fetch_scan(this._hass_raw, { include_disabled: false, exclude_hse: true }); }
            catch (err) { this._scan_result = { error: String(err), integrations: [], candidates: [] }; }
            finally { this._scan_state.scan_running = false; if (this._active_tab === 'scan') this.requestUpdate(); }
          }
        });
      }

      // ── Onglet Migration ──────────────────────────────────────────────
      async _tab_migration(content) {
        if (!window.hse_migration_view || !window.hse_migration_api) {
          this._tab_placeholder(content, 'Migration', 'migration.view.js non chargé.'); return;
        }
        content.innerHTML = '';
        const run = async (opt) => {
          this._migration_state.loading = true; this._migration_state.error = null;
          this.requestUpdate();
          try {
            const resp = await window.hse_migration_api.export_yaml(this._hass_raw, { mode: 'selection' });
            this._migration_state.last = resp;
            this._migration_state.active_yaml = resp?.exports?.[opt] || '';
          } catch (err) {
            this._migration_state.error = String(err);
          } finally {
            this._migration_state.loading = false;
            if (this._active_tab === 'migration') this.requestUpdate();
          }
        };
        window.hse_migration_view.render_migration(content, this._migration_state, async (action, payload) => {
          if (action === 'export' || action === 'preview') { await run(payload?.option); }
        });
      }

      // ── Onglet Cards ──────────────────────────────────────────────────
      _tab_cards(content) {
        if (!window.hse_cards_controller?.render_cards) {
          this._tab_placeholder(content, 'Génération cartes', 'cards.controller.js non chargé.'); return;
        }
        content.innerHTML = '';
        window.hse_cards_controller.render_cards(content, this._hass_raw);
      }

      // ── Onglet Custom ─────────────────────────────────────────────────
      _tab_custom(content) {
        if (!window.hse_custom_view?.render_customisation) {
          this._tab_placeholder(content, 'Customisation', 'custom.view.js non chargé.'); return;
        }
        const act = this._actions;
        if (!this._org_state.meta_store && !this._org_state.loading && !this._org_state.error) {
          act.org_fetch_meta();
        }
        const _do_render = () => {
          content.innerHTML = '';
          window.hse_custom_view.render_customisation(content, this._custom_state, this._org_state, _on_action);
        };
        const _on_action = (action, value) => {
          if (action === 'set_theme')         { this._set_theme(value || 'ha'); return; }
          if (action === 'toggle_dynamic_bg') { this._custom_state.dynamic_bg = !this._custom_state.dynamic_bg; this._storage_set('hse_custom_dynamic_bg', this._custom_state.dynamic_bg ? '1' : '0'); this._apply_dynamic_bg_override(); this.requestUpdate(); return; }
          if (action === 'toggle_glass')      { this._custom_state.glass = !this._custom_state.glass; this._storage_set('hse_custom_glass', this._custom_state.glass ? '1' : '0'); this._apply_glass_override(); this.requestUpdate(); return; }
          if (action === 'org_refresh')  { act.org_fetch_meta(); return; }
          if (action === 'org_preview')  { act.org_preview(); return; }
          if (action === 'org_apply')    { act.org_apply(value?.apply_mode || 'auto'); return; }
          if (action === 'org_save')     { act.org_save_meta(); return; }
          if (action === 'org_draft_reset') {
            const ok = window.confirm('Réinitialiser le brouillon (perdre les modifications locales non sauvegardées) ?');
            if (!ok) return;
            act._org_reset_draft_from_store();
            _do_render(); return;
          }
          if (action === 'org_patch') {
            const { path_parts, path, value: v, no_render } = value || {};
            act._org_ensure_draft();
            if (Array.isArray(path_parts) && path_parts.length) {
              let cur = this._org_state.meta_draft;
              for (let i = 0; i < path_parts.length - 1; i++) {
                if (!cur[path_parts[i]] || typeof cur[path_parts[i]] !== 'object') cur[path_parts[i]] = {};
                cur = cur[path_parts[i]];
              }
              cur[path_parts[path_parts.length - 1]] = v;
            } else { act._deep_set(this._org_state.meta_draft, path, v); }
            this._org_state.dirty = true;
            if (!no_render) _do_render(); return;
          }
          if (action === 'org_room_add') {
            const { room_id, name } = value || {};
            if (!room_id) return;
            act._org_ensure_draft();
            const rooms = this._org_state.meta_draft.rooms;
            if (rooms[room_id]) { this._org_state.message = `Room existe déjà: ${room_id}`; _do_render(); return; }
            rooms[room_id] = { name: name || room_id, mode: 'mixed', name_mode: 'mixed', ha_area_id: null };
            this._org_state.dirty = true; this._org_state.message = `Room ajoutée: ${room_id}`;
            _do_render(); return;
          }
          if (action === 'org_room_delete') {
            const { room_id } = value || {};
            if (!room_id) return;
            act._org_ensure_draft();
            delete this._org_state.meta_draft.rooms[room_id];
            this._org_state.dirty = true; this._org_state.message = `Room supprimée: ${room_id}`;
            _do_render(); return;
          }
          if (action === 'org_assignment_add') {
            const { entity_id } = value || {};
            if (!entity_id) return;
            act._org_ensure_draft();
            const asg = this._org_state.meta_draft.assignments;
            if (asg[entity_id]) { this._org_state.message = `Assignment existe déjà: ${entity_id}`; _do_render(); return; }
            asg[entity_id] = { room_id: null, room_mode: 'mixed', type_id: null, type_mode: 'mixed' };
            this._org_state.dirty = true; this._org_state.message = `Assignment ajoutée: ${entity_id}`;
            _do_render(); return;
          }
          if (action === 'org_assignment_delete') {
            const { entity_id } = value || {};
            if (!entity_id) return;
            act._org_ensure_draft();
            delete this._org_state.meta_draft.assignments[entity_id];
            this._org_state.dirty = true; this._org_state.message = `Assignment supprimée: ${entity_id}`;
            _do_render(); return;
          }
          if (action === 'org_toggle_raw')  { this._org_state.show_raw = !this._org_state.show_raw; _do_render(); return; }
          if (action === 'org_rerender')    { _do_render(); return; }
        };
        _do_render();
      }

      // ── Onglet Config ─────────────────────────────────────────────────
      async _tab_config(content) {
        if (!window.hse_config_view || !window.hse_config_api || !window.hse_scan_api) {
          this._tab_placeholder(content, 'Configuration', 'config.view.js non chargé.'); return;
        }
        await this._tab_config_impl(content);
      }

      // ── Onglet Diagnostic ─────────────────────────────────────────────
      async _tab_diagnostic(content) {
        if (!window.hse_diag_view || !window.hse_diag_api) {
          this._tab_placeholder(content, 'Diagnostic', 'diagnostic.view.js non chargé.'); return;
        }
        await this._tab_diagnostic_impl(content);
      }

      // ── Placeholder ───────────────────────────────────────────────────
      _tab_placeholder(content, title, subtitle) {
        if (!window.hse_dom) return;
        const { el } = window.hse_dom;
        content.innerHTML = '';
        const card = el('div', 'hse_card');
        card.appendChild(el('div', null, title));
        card.appendChild(el('div', 'hse_subtitle', subtitle || 'À venir.'));
        content.appendChild(card);
      }

      _render_error(content, ctx, err) {
        console.error(`[HSE] UI error in ${ctx}`, err);
        if (!window.hse_dom) return;
        const { el } = window.hse_dom;
        content.innerHTML = '';
        const card = el('div', 'hse_card');
        card.appendChild(el('div', null, `Erreur UI: ${ctx}`));
        card.appendChild(el('pre', 'hse_code', String(err?.message || err)));
        content.appendChild(card);
      }

      // ── Overview autorefresh ──────────────────────────────────────────
      _ensure_overview_autorefresh() {
        if (this._overview_timer) return;
        const tick = async () => {
          if (this._overview_refreshing) return;
          this._overview_refreshing = true;
          try {
            const fn = window.hse_overview_api?.fetch_overview || window.hse_overview_api?.fetch_manifest_and_ping;
            if (!fn) throw new Error('overview_api_not_loaded');
            window.hse_overview_state?.begin_fetch?.();
            const data = await fn(this._hass_raw);
            this._overview_data = data;
            const body = this.shadowRoot?.querySelector('[data-hse-overview-body]');
            window.hse_overview_state?.end_fetch?.(data, this._hass_raw, body ?? null);
          } catch (err) {
            // Erreur WebSocket HA (Subscription not found, etc.) : on ignore
            // silencieusement pour ne pas polluer la console ni bloquer le render
            const msg = String(err?.message || err?.code || err || '');
            const is_ws_err = msg.includes('not_found') || msg.includes('Subscription') || msg.includes('WebSocket');
            if (!is_ws_err) {
              const d = { error: msg };
              this._overview_data = d;
              const body = this.shadowRoot?.querySelector('[data-hse-overview-body]');
              window.hse_overview_state?.end_fetch?.(d, this._hass_raw, body ?? null);
            }
          } finally {
            this._overview_refreshing = false;
            if (!this._overview_built) this.requestUpdate();
          }
        };
        this._overview_timer = window.setInterval(tick, 30000);
        if (!window.hse_overview_state?.get('data')) tick();
      }

      _clear_overview_autorefresh() {
        if (this._overview_timer) try { window.clearInterval(this._overview_timer); } catch (_) {}
        this._overview_timer = null;
        this._overview_refreshing = false;
      }

      _clear_reference_status_polling() {
        if (this._reference_status_timer) try { window.clearInterval(this._reference_status_timer); } catch (_) {}
        this._reference_status_timer = null;
        this._reference_status_polling = false;
        this._reference_status_target_entity_id = undefined;
      }

      _ensure_reference_status_polling() {
        if (this._reference_status_timer) return;
        if (!this._hass_raw || !window.hse_config_api?.get_reference_total_status) return;
        const tick = async () => { await this._actions?.fetch_reference_status(); };
        this._reference_status_timer = window.setInterval(tick, 4000);
        tick();
      }

      // ── Navigation ────────────────────────────────────────────────────
      _get_nav_items() {
        const from_shell = window.hse_shell?.get_nav_items?.();
        const items = Array.isArray(from_shell) && from_shell.length ? from_shell : NAV_ITEMS_FALLBACK;
        return items.filter(x => x && x.id !== 'enrich');
      }

      _set_active_tab(tab_id) {
        // Reset overview built flag à chaque changement d'onglet
        this._overview_built = false;
        this._active_tab = tab_id;
        this._storage_set('hse_active_tab', tab_id);
      }

      // ── Theme ─────────────────────────────────────────────────────────
      _set_theme(theme_key) {
        this._theme = theme_key || 'ha';
        this._custom_state.theme = this._theme;
        this.setAttribute('data-theme', this._theme);
        this._storage_set('hse_theme', this._theme);
      }

      _apply_dynamic_bg_override() {
        this.style.setProperty('--hse-bg-dynamic-opacity', this._custom_state.dynamic_bg ? '' : '0');
      }

      _apply_glass_override() {
        this.style.setProperty('--hse-backdrop-filter', this._custom_state.glass ? 'blur(18px) saturate(160%)' : '');
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
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/diagnostic/diag.state.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/features/config/config.state.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/core/shell.js?v=${ASSET_V}`);
          await window.hse_loader.load_script_once(`${PANEL_BASE}/core/panel.actions.js?v=${ASSET_V}`);
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

          // ── Réinit modules si hse_store a été recréé ──────────────────
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

          this._boot_done  = true;
          this._boot_error = null;
        } catch (err) {
          this._boot_error = err?.message || String(err);
          console.error('[HSE] boot error', err);
        } finally {
          this._booting = false;
        }
      }

      // ── Implémentations config & diagnostic ──────────────────────────
      async _tab_config_impl(content) {
        const _cg = (k) => this._actions._cg(k);
        const _cs = (k, v) => this._actions._cs(k, v);
        const _err = (e) => this._actions._err_msg(e);
        const p = this;

        if (_cg('loading')) {
          const { el } = window.hse_dom;
          content.innerHTML = '';
          const card = el('div', 'hse_card');
          card.appendChild(el('div', null, 'Configuration'));
          card.appendChild(el('div', 'hse_subtitle', 'Chargement…'));
          content.appendChild(card);
          return;
        }

        const _effective_ref = () => _cg('selected_reference_entity_id') || _cg('current_reference_entity_id') || null;

        const _ensure_pricing_draft = () => {
          if (!_cg('pricing_draft')) {
            const base = JSON.parse(JSON.stringify(_cg('pricing_defaults') || {}));
            const pr   = JSON.parse(JSON.stringify(_cg('pricing') || {}));
            p._actions._deep_fill_missing(pr, base);
            _cs('pricing_draft', pr);
          } else {
            p._actions._deep_fill_missing(_cg('pricing_draft'), _cg('pricing_defaults') || {});
          }
        };

        const _cost_ids = () => {
          _ensure_pricing_draft();
          const arr = _cg('pricing_draft')?.cost_entity_ids;
          return Array.isArray(arr) ? arr : [];
        };

        const _remove_ref_from_cost = () => {
          const ref = _effective_ref(); if (!ref) return false;
          const ids = _cost_ids(); if (!ids.includes(ref)) return false;
          _cg('pricing_draft').cost_entity_ids = ids.filter(x => x !== ref);
          return true;
        };

        const _update_from_catalogue = (cat) => {
          _cs('catalogue', cat);
          const cur = window.hse_config_view._current_reference_entity_id(cat);
          _cs('current_reference_entity_id', cur);
          if (_cg('selected_reference_entity_id') == null) _cs('selected_reference_entity_id', cur);
          const snapshot = window.hse_config_view._reference_status_from_catalogue?.(cat, _cg('selected_reference_entity_id') || cur || null);
          if (snapshot && typeof snapshot === 'object') {
            _cs('reference_status', { ...(_cg('reference_status') || {}), ...snapshot, entity_id: snapshot.entity_id || cur || _cg('selected_reference_entity_id') || null });
          }
          if (_cg('pricing_draft') && _remove_ref_from_cost()) _cs('pricing_message', 'Garde-fou: le capteur de référence a été retiré des capteurs de calcul.');
        };

        const _update_from_pricing = (resp) => {
          const pr = resp?.pricing || null, defs = resp?.defaults || null;
          _cs('pricing', pr); _cs('pricing_defaults', defs);
          if (_cg('pricing_draft') == null) {
            const base = JSON.parse(JSON.stringify(defs || {}));
            const cur  = JSON.parse(JSON.stringify(pr || {}));
            p._actions._deep_fill_missing(cur, base);
            _cs('pricing_draft', cur);
          } else { p._actions._deep_fill_missing(_cg('pricing_draft'), _cg('pricing_defaults') || {}); }
          if (_remove_ref_from_cost()) _cs('pricing_message', 'Garde-fou: le capteur de référence a été retiré des capteurs de calcul.');
        };

        const _group_key = (c) => (!c || !c.device_id) ? null : `${c.device_id}|${c.kind||''}|${c.device_class||''}|${c.state_class||''}`;
        const _candidate_index = () => {
          const items = Array.isArray(_cg('scan_result')?.candidates) ? _cg('scan_result').candidates : [];
          const map = new Map();
          for (const c of items) { if (c?.entity_id) map.set(c.entity_id, c); }
          return map;
        };
        const _validate_no_dup = (entity_ids) => {
          const idx = _candidate_index(), seen = new Map(), conflicts = new Map();
          for (const eid of entity_ids || []) {
            const gk = _group_key(idx.get(eid)); if (!gk) continue;
            const prev = seen.get(gk);
            if (!prev) { seen.set(gk, eid); continue; }
            conflicts.set(gk, [prev, eid]);
          }
          if (!conflicts.size) return null;
          return ['doublons:interdit', ...[...conflicts.entries()].map(([gk, pair]) => `${gk} -> ${pair.join(' , ')}`)].join('\n');
        };

        if (!_cg('catalogue') && !_cg('loading')) {
          _cs('loading', true); _cs('error', null); _cs('message', null); _cs('pricing_error', null); _cs('pricing_message', null);
          p.requestUpdate();
          try {
            _cs('scan_result', await window.hse_scan_api.fetch_scan(p._hass_raw, { include_disabled: false, exclude_hse: true }));
            _update_from_catalogue(await window.hse_config_api.fetch_catalogue(p._hass_raw));
            _update_from_pricing(await window.hse_config_api.fetch_pricing(p._hass_raw));
            await p._actions.fetch_reference_status();
          } catch (err) { _cs('error', _err(err)); }
          finally { _cs('loading', false); p.requestUpdate(); }
          return;
        }

        p._ensure_reference_status_polling();

        content.innerHTML = '';
        window.hse_config_view.render_config(content, p._config_state, async (action, value) => {
          const _ds = (obj, path, v) => p._actions._deep_set(obj, path, v);
          if (action === 'cost_filter')          { _cs('cost_filter_q', value || ''); p.requestUpdate(); return; }
          if (action === 'cost_auto_select')     { _ensure_pricing_draft(); _cg('pricing_draft').cost_entity_ids = Array.isArray(value?.entity_ids) ? value.entity_ids : []; if (_remove_ref_from_cost()) _cs('pricing_message', 'Garde-fou: le capteur de référence a été retiré des capteurs de calcul.'); else _cs('pricing_message', `Sélection automatique appliquée (${(value?.entity_ids||[]).length} capteurs).`); _cs('pricing_error', null); p.requestUpdate(); return; }
          if (action === 'pricing_list_replace') { const { from_entity_id: from, to_entity_id: to } = value||{}; if (!from||!to) return; const ids = _cost_ids().filter(x=>x!==from); if (!ids.includes(to)) ids.push(to); _cg('pricing_draft').cost_entity_ids = ids; _cs('pricing_message', `Remplacement: ${from} → ${to}`); _cs('pricing_error', null); p.requestUpdate(); return; }
          if (action === 'select_reference')     { _cs('selected_reference_entity_id', value); _cs('message', null); _cs('reference_status_error', null); const nxt = value || _cg('current_reference_entity_id') || null; if ((_cg('reference_status')?.entity_id||null) !== nxt) _cs('reference_status', null); p.requestUpdate(); await p._actions.fetch_reference_status(value||undefined); return; }
          if (action === 'pricing_patch')        { const { path, value: v, no_render } = value||{}; _ensure_pricing_draft(); _ds(_cg('pricing_draft'), path, v); if (path==='contract_type') p._actions._deep_fill_missing(_cg('pricing_draft'), _cg('pricing_defaults')||{}); _cs('pricing_message', null); _cs('pricing_error', null); if (!no_render) p.requestUpdate(); return; }
          if (action === 'pricing_list_add') {
            const eid = value?.entity_id; if (!eid) return;
            const ref = _effective_ref();
            if (ref && eid === ref) { _cs('pricing_message', 'Impossible: le capteur de référence ne peut pas être inclus dans les capteurs de calcul.'); _cs('pricing_error', null); p.requestUpdate(); return; }
            const ids = _cost_ids(), idx = _candidate_index(), gk = _group_key(idx.get(eid));
            if (gk) { for (const ex of ids) { const gg = _group_key(idx.get(ex)); if (gg && gg===gk && ex!==eid) { _cs('pricing_message', `Doublon interdit: ${eid} est équivalent à ${ex} (même appareil). Utilise Remplacer.`); _cs('pricing_error', null); p.requestUpdate(); return; } } }
            if (!ids.includes(eid)) ids.push(eid);
            _cg('pricing_draft').cost_entity_ids = ids; _cs('pricing_message', null); _cs('pricing_error', null); p.requestUpdate(); return;
          }
          if (action === 'pricing_list_remove')  { const eid = value?.entity_id; if (!eid) return; _cg('pricing_draft').cost_entity_ids = _cost_ids().filter(x=>x!==eid); _cs('pricing_message', null); _cs('pricing_error', null); p.requestUpdate(); return; }
          if (action === 'pricing_clear') {
            if (!window.confirm('Effacer les tarifs enregistrés ?')) return;
            _cs('pricing_saving', true); _cs('pricing_error', null); _cs('pricing_message', 'Suppression…'); p.requestUpdate();
            try { await window.hse_config_api.clear_pricing(p._hass_raw); _cs('pricing_draft', null); _update_from_pricing(await window.hse_config_api.fetch_pricing(p._hass_raw)); _cs('pricing_message', 'Tarifs effacés.'); }
            catch (err) { _cs('pricing_error', _err(err)); }
            finally { _cs('pricing_saving', false); p.requestUpdate(); }
            return;
          }
          if (action === 'pricing_save') {
            _ensure_pricing_draft(); p._actions._deep_fill_missing(_cg('pricing_draft'), _cg('pricing_defaults')||{});
            if (_remove_ref_from_cost()) _cs('pricing_message', 'Garde-fou: le capteur de référence a été retiré des capteurs de calcul.');
            const errDup = _validate_no_dup(_cost_ids());
            if (errDup) { _cs('pricing_error', errDup); _cs('pricing_message', 'Impossible de sauvegarder: doublons détectés dans la sélection.'); p.requestUpdate(); return; }
            _cs('pricing_saving', true); _cs('pricing_error', null); _cs('pricing_message', 'Sauvegarde en préparation…'); p.requestUpdate();
            await new Promise(r => { try { window.requestAnimationFrame(r); } catch(_) { window.setTimeout(r, 0); } });
            if (!window.confirm('Sauvegarder ces tarifs (et la sélection de capteurs) ?\nEnsuite HSE va créer automatiquement les helpers nécessaires.')) { _cs('pricing_saving', false); _cs('pricing_message', null); p.requestUpdate(); return; }
            const ids_for_enrich = _cost_ids().slice();
            _cs('pricing_error', null); _cs('pricing_message', 'Sauvegarde…'); p.requestUpdate();
            try {
              await window.hse_config_api.set_pricing(p._hass_raw, _cg('pricing_draft'));
              _cs('pricing_draft', null); _update_from_pricing(await window.hse_config_api.fetch_pricing(p._hass_raw));
              _cs('pricing_message', 'Tarifs sauvegardés. Création des capteurs (helpers) en cours… (attends ~30s)'); p.requestUpdate();
              if (window.hse_enrich_api?.apply) {
                try {
                  const applied = await window.hse_enrich_api.apply(p._hass_raw, { mode: 'create_helpers', entity_ids: ids_for_enrich });
                  const sc = applied?.summary || {};
                  const created = sc.created_count ?? (Array.isArray(applied?.created) ? applied.created.length : 0);
                  const skipped = sc.skipped_count ?? (Array.isArray(applied?.skipped) ? applied.skipped.length : 0);
                  const errs    = sc.errors_count  ?? (Array.isArray(applied?.errors)  ? applied.errors.length  : 0);
                  _cs('pricing_message', errs > 0
                    ? `Tarifs sauvegardés. Helpers: créés ${created}, ignorés ${skipped}, erreurs ${errs}.`
                    : `Tarifs sauvegardés. Helpers: créés ${created}, ignorés ${skipped}. (attends ~30s)`);
                } catch(err) { _cs('pricing_message', `Tarifs sauvegardés. Création auto helpers en échec: ${_err(err)}.`); }
              }
            } catch(err) { _cs('pricing_error', _err(err)); }
            finally { _cs('pricing_saving', false); p.requestUpdate(); }
            return;
          }
          if (action === 'refresh') {
            _cs('loading', true); _cs('error', null); _cs('message', null); _cs('pricing_error', null); _cs('pricing_message', null); _cs('reference_status_error', null); p.requestUpdate();
            try { await window.hse_config_api.refresh_catalogue(p._hass_raw); _cs('scan_result', await window.hse_scan_api.fetch_scan(p._hass_raw, { include_disabled: false, exclude_hse: true })); _update_from_catalogue(await window.hse_config_api.fetch_catalogue(p._hass_raw)); _update_from_pricing(await window.hse_config_api.fetch_pricing(p._hass_raw)); await p._actions.fetch_reference_status(); }
            catch(err) { _cs('error', _err(err)); }
            finally { _cs('loading', false); p.requestUpdate(); }
            return;
          }
          if (action === 'clear_reference') {
            if (!window.confirm('Supprimer la référence compteur ?')) return;
            _cs('saving', true); _cs('error', null); _cs('message', null); _cs('reference_status_error', null); p.requestUpdate();
            try { await window.hse_config_api.set_reference_total(p._hass_raw, null); _update_from_catalogue(await window.hse_config_api.fetch_catalogue(p._hass_raw)); _cs('selected_reference_entity_id', null); _cs('reference_status', null); await p._actions.fetch_reference_status(null); _cs('message', 'Référence supprimée.'); }
            catch(err) { _cs('error', _err(err)); }
            finally { _cs('saving', false); p.requestUpdate(); }
            return;
          }
          if (action === 'save_reference') {
            const entity_id = _cg('selected_reference_entity_id');
            if (!entity_id) { _cs('message', 'Aucune référence sélectionnée (rien à sauvegarder).'); p.requestUpdate(); return; }
            _ensure_pricing_draft();
            const ids = _cost_ids();
            if (ids.includes(entity_id)) { _cg('pricing_draft').cost_entity_ids = ids.filter(x=>x!==entity_id); _cs('pricing_message', 'Garde-fou: la référence a été retirée des capteurs de calcul.'); }
            if (!window.confirm(`Définir la référence compteur sur ${entity_id} ?\n(Elle sera exclue des totaux mesurés)`)) return;
            _cs('saving', true); _cs('error', null); _cs('message', null); _cs('reference_status_error', null); p.requestUpdate();
            try {
              try { await window.hse_config_api.set_reference_total(p._hass_raw, entity_id); }
              catch(_) { await window.hse_config_api.refresh_catalogue(p._hass_raw); await window.hse_config_api.set_reference_total(p._hass_raw, entity_id); }
              _update_from_catalogue(await window.hse_config_api.fetch_catalogue(p._hass_raw));
              await p._actions.fetch_reference_status(entity_id); _cs('message', 'Référence sauvegardée.');
            } catch(err) { _cs('error', _err(err)); }
            finally { _cs('saving', false); p.requestUpdate(); }
            return;
          }
        });
        content.setAttribute('data-hse-config-built', '1');
      }

      async _tab_diagnostic_impl(content) {
        const p = this;
        const _dg = (k) => p._actions._dg(k);
        const _ds = (k, v) => p._actions._ds(k, v);
        const _err = (e) => p._actions._err_msg(e);

        const diag_api = {
          fetch_catalogue:    () => window.hse_diag_api.fetch_catalogue(p._hass_raw),
          refresh_catalogue:  () => window.hse_diag_api.refresh_catalogue(p._hass_raw),
          set_item_triage:    (id, t) => window.hse_diag_api.set_item_triage(p._hass_raw, id, t),
          bulk_triage:        (ids, t) => window.hse_diag_api.bulk_triage(p._hass_raw, ids, t),
          check_consistency:  (payload) => p._hass_raw.callApi('post', 'hse/unified/diagnostic/check', payload),
        };

        const _wrap = async (label, fn, meta) => {
          try { _ds('last_action', label); _ds('last_request', meta||null); const r = await fn(); _ds('last_response', r); return r; }
          catch(err) { _ds('last_response', { error: _err(err) }); throw err; }
        };

        const _default_check_req = (entity_ids) => ({
          entity_ids,
          checks: ['catalogue_duplicates','config_entry_consistency','entity_presence','helper_consistency'],
          include_history: true,
        });

        if (!_dg('data') && !_dg('loading')) {
          _ds('loading', true);
          try { _ds('data', await _wrap('fetch_catalogue', () => diag_api.fetch_catalogue(), { method:'get', path:'hse/unified/catalogue', body:null })); _ds('error', null); }
          catch(err) { _ds('error', _err(err)); }
          finally { _ds('loading', false); }
        }

        if (_dg('error')) { content.innerHTML = ''; content.appendChild(window.hse_dom.el('div','hse_card',`Erreur: ${_dg('error')}`)); return; }
        if (!_dg('data')) { content.innerHTML = ''; content.appendChild(window.hse_dom.el('div','hse_card','Chargement…')); return; }

        const _sel_ids     = () => Object.keys(_dg('selected')||{}).filter(k=>_dg('selected')[k]);
        const _filt_ids    = () => (window.hse_diag_view?._filtered_escalated_items?.(_dg('data'), _dg('filter_q'))||[]).map(x=>x.id);
        const _filt_eids   = () => { const grouped = window.hse_diag_view?._group_escalated_items?.(window.hse_diag_view?._filtered_escalated_items?.(_dg('data'),_dg('filter_q'))||[])||[]; return grouped.map(g=>g.entity_id).filter(Boolean); };
        const _all_eids    = () => Array.from(new Set(Object.values(_dg('data')?.items||{}).map(x=>x?.source?.entity_id).filter(Boolean))).sort();
        const _mute_until  = (days) => { const fn=window.hse_diag_view?._local_iso_days_from_now; if(fn) return fn(days); const dd=new Date(); dd.setDate(dd.getDate()+days); const p2=n=>String(n).padStart(2,'0'); const tzM=-dd.getTimezoneOffset(), sign=tzM>=0?'+':'-', tzA=Math.abs(tzM); return `${dd.getFullYear()}-${p2(dd.getMonth()+1)}-${p2(dd.getDate())}T${p2(dd.getHours())}:${p2(dd.getMinutes())}:${p2(dd.getSeconds())}${sign}${p2(Math.floor(tzA/60))}:${p2(tzA%60)}`; };

        content.innerHTML = '';
        window.hse_diag_view.render_diagnostic(content, _dg('data'), p._diag_state, async (action, payload) => {
          if (action==='toggle_advanced')    { _ds('advanced',!_dg('advanced')); p.requestUpdate(); return; }
          if (action==='filter')             { _ds('filter_q',payload||''); _ds('selected',{}); p.requestUpdate(); return; }
          if (action==='select')             { if(payload?.item_id){ const s=_dg('selected')||{}; s[payload.item_id]=!!payload.checked; _ds('selected',s); } p.requestUpdate(); return; }
          if (action==='select_none')        { _ds('selected',{}); p.requestUpdate(); return; }
          if (action==='select_all_filtered'){ const s=_dg('selected')||{}; for(const id of _filt_ids()) s[id]=true; _ds('selected',s); p.requestUpdate(); return; }
          if (action==='check_coherence') {
            const eids = _filt_eids(); const req = _default_check_req(eids.length?eids:_all_eids());
            _ds('check_loading',true); _ds('check_error',null); p.requestUpdate();
            try { _ds('check_result', await _wrap('diagnostic_check',()=>diag_api.check_consistency(req),{method:'post',path:'hse/unified/diagnostic/check',body:req})); _ds('check_error',null); }
            catch(err) { _ds('check_error',_err(err)); }
            finally { _ds('check_loading',false); if(p._active_tab==='diagnostic') p.requestUpdate(); }
            return;
          }
          if (action==='bulk_mute') {
            const mode=payload?.mode||'selection', ids=mode==='filtered'?_filt_ids():_sel_ids(), days=payload?.days||7;
            if(!ids.length) return;
            if(!window.confirm(`Appliquer MUTE ${days}j sur ${ids.length} item(s) (${mode}) ?`)) return;
            await _wrap('bulk_triage/mute',()=>diag_api.bulk_triage(ids,{mute_until:_mute_until(days)}),{method:'post',path:'hse/unified/catalogue/triage/bulk',body:{item_ids:ids,triage:{mute_until:_mute_until(days)}}});
            _ds('data', await _wrap('fetch_catalogue',()=>diag_api.fetch_catalogue(),{method:'get',path:'hse/unified/catalogue',body:null}));
            if(p._active_tab==='diagnostic') p.requestUpdate(); return;
          }
          if (action==='bulk_removed') {
            const mode=payload?.mode||'selection', ids=mode==='filtered'?_filt_ids():_sel_ids();
            if(!ids.length) return;
            if(!window.confirm(`Appliquer REMOVED sur ${ids.length} item(s) (${mode}) ?`)) return;
            await _wrap('bulk_triage/removed',()=>diag_api.bulk_triage(ids,{policy:'removed'}),{});
            _ds('data', await _wrap('fetch_catalogue',()=>diag_api.fetch_catalogue(),{}));
            if(p._active_tab==='diagnostic') p.requestUpdate(); return;
          }
          if (action==='consolidate_history') {
            const {entity_id, item_ids} = payload||{};
            if(!entity_id||!item_ids?.length) return;
            if(!window.confirm(`Archiver ${item_ids.length} doublon(s) historique(s) pour ${entity_id} ?`)) return;
            await _wrap('bulk_triage/archived',()=>diag_api.bulk_triage(item_ids,{policy:'archived',note:'auto_consolidated_from_diagnostic'}),{});
            _ds('data', await _wrap('fetch_catalogue',()=>diag_api.fetch_catalogue(),{}));
            const req = _default_check_req([entity_id]);
            _ds('check_loading',true); _ds('check_error',null); if(p._active_tab==='diagnostic') p.requestUpdate();
            try { _ds('check_result', await _wrap('diagnostic_check',()=>diag_api.check_consistency(req),{})); _ds('check_error',null); }
            catch(err) { _ds('check_error',_err(err)); }
            finally { _ds('check_loading',false); if(p._active_tab==='diagnostic') p.requestUpdate(); }
            return;
          }
          if (action==='refresh') {
            await _wrap('refresh_catalogue',()=>diag_api.refresh_catalogue(),{});
            _ds('data', await _wrap('fetch_catalogue',()=>diag_api.fetch_catalogue(),{}));
            if(p._active_tab==='diagnostic') p.requestUpdate(); return;
          }
          if (action==='mute') {
            await _wrap('set_item_triage/mute',()=>diag_api.set_item_triage(payload.item_id,{mute_until:payload.mute_until}),{});
            _ds('data', await _wrap('fetch_catalogue',()=>diag_api.fetch_catalogue(),{}));
            if(p._active_tab==='diagnostic') p.requestUpdate(); return;
          }
          if (action==='removed') {
            await _wrap('set_item_triage/removed',()=>diag_api.set_item_triage(payload.item_id,{policy:'removed'}),{});
            _ds('data', await _wrap('fetch_catalogue',()=>diag_api.fetch_catalogue(),{}));
            if(p._active_tab==='diagnostic') p.requestUpdate(); return;
          }
        });
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
