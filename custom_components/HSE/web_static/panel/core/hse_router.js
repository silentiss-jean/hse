/**
 * hse_router.js — Routeur d'onglets HSE
 *
 * Découplé de hse_panel.js. Gère :
 *   - la liste des onglets disponibles
 *   - l'onglet actif (persisté en localStorage)
 *   - le rendu du DOM de navigation (tabs bar)
 *   - la visibilité des conteneurs d'onglets (hidden CSS, pas de destroy)
 *
 * Dépend de : HseStore (hse_store.js), window.hse_dom
 *
 * Usage :
 *   const router = new HseRouter(tabsEl, contentEl, nav_items);
 *   router.init();           // restaure l'onglet persisté
 *   router.goto("custom");   // change d'onglet
 */

(function () {
  "use strict";

  class HseRouter {
    /**
     * @param {HTMLElement} tabs_el       — conteneur des boutons de navigation
     * @param {HTMLElement} content_el    — conteneur principal des vues
     * @param {Array<{id:string,label:string}>} nav_items
     */
    constructor(tabs_el, content_el, nav_items) {
      this._tabs_el = tabs_el;
      this._content_el = content_el;
      this._nav_items = nav_items || [];

      /** @type {Map<string, HTMLElement>} conteneurs stables par tab id */
      this._tab_containers = new Map();

      this._active = null;
      this._on_activate_callbacks = new Map(); // tab_id → fn(container)
    }

    // ─── Initialisation ────────────────────────────────────────────────────────

    init() {
      this._build_tab_containers();
      this._build_nav();

      const saved = this._storage_get("hse_active_tab");
      const first = this._nav_items[0]?.id || "overview";
      const initial = this._nav_items.some((x) => x.id === saved) ? saved : first;

      this.goto(initial, { silent: false });
    }

    // ─── Navigation ────────────────────────────────────────────────────────────

    /**
     * Active un onglet.
     * Ne détruit JAMAIS le DOM des autres onglets — utilise hidden.
     * @param {string} tab_id
     * @param {{silent?:boolean}} [opts]
     */
    goto(tab_id, opts = {}) {
      if (!this._nav_items.some((x) => x.id === tab_id)) {
        tab_id = this._nav_items[0]?.id || "overview";
      }

      const prev = this._active;
      this._active = tab_id;

      this._storage_set("hse_active_tab", tab_id);
      HseStore.set("tab_active", tab_id);

      // Visibilité des conteneurs
      this._tab_containers.forEach((el, id) => {
        el.hidden = id !== tab_id;
      });

      // Mise à jour visuelle des boutons nav
      this._update_nav_active();

      // Appel du callback d'activation si enregistré
      if (!opts.silent) {
        const cb = this._on_activate_callbacks.get(tab_id);
        if (cb) {
          const container = this._tab_containers.get(tab_id);
          try {
            cb(container, prev);
          } catch (err) {
            console.error(`[HseRouter] activation callback error for tab "${tab_id}"`, err);
          }
        }
      }
    }

    /**
     * Enregistre un callback appelé à chaque fois que l'onglet devient actif.
     * Le callback reçoit (container: HTMLElement, prev_tab_id: string|null).
     * @param {string} tab_id
     * @param {Function} fn
     */
    on_activate(tab_id, fn) {
      this._on_activate_callbacks.set(tab_id, fn);
    }

    /**
     * Retourne le conteneur stable d'un onglet (jamais détruit).
     * @param {string} tab_id
     * @returns {HTMLElement|null}
     */
    get_container(tab_id) {
      return this._tab_containers.get(tab_id) || null;
    }

    get active() {
      return this._active;
    }

    // ─── Construction DOM ──────────────────────────────────────────────────────

    _build_tab_containers() {
      for (const item of this._nav_items) {
        if (this._tab_containers.has(item.id)) continue;

        const div = document.createElement("div");
        div.dataset.hseTab = item.id;
        div.hidden = true;
        div.setAttribute("role", "tabpanel");
        div.setAttribute("aria-label", item.label);
        this._content_el.appendChild(div);
        this._tab_containers.set(item.id, div);
      }
    }

    _build_nav() {
      const { el } = window.hse_dom;
      // Vide les boutons existants
      while (this._tabs_el.firstChild) this._tabs_el.removeChild(this._tabs_el.firstChild);

      for (const item of this._nav_items) {
        const btn = el("button", "hse_tab", item.label);
        btn.dataset.tabId = item.id;
        btn.setAttribute("role", "tab");
        btn.addEventListener("click", () => this.goto(item.id));
        this._tabs_el.appendChild(btn);
      }
    }

    _update_nav_active() {
      const btns = this._tabs_el.querySelectorAll("button[data-tab-id]");
      btns.forEach((btn) => {
        btn.dataset.active = btn.dataset.tabId === this._active ? "true" : "false";
        btn.setAttribute("aria-selected", btn.dataset.tabId === this._active ? "true" : "false");
      });
    }

    // ─── Persistence ───────────────────────────────────────────────────────────

    _storage_get(key) {
      try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }

    _storage_set(key, value) {
      try { window.localStorage.setItem(key, value); } catch (_) {}
    }
  }

  window.HseRouter = HseRouter;
  console.debug("[HseRouter] loaded");
})();
