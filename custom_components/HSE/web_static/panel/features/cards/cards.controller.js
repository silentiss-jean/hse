(function () {
  "use strict";

  let _instance = null;

  class CardsController {
    constructor(hass, root) {
      this._hass = hass;
      this._root = root;
      this._sensors = [];
      this._sensors_enriched = [];
      this._yaml = "";
      this._pf_row_seq = 0;
      this._pf_all_facture_total = [];
    }

    _$(id) {
      return this._root.getElementById(id);
    }

    _normalize(value) {
      const raw = String(value || "").toLowerCase();
      try {
        return raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9_\-\s]/g, " ").replace(/\s+/g, " ").trim();
      } catch (_) {
        return raw.replace(/\s+/g, " ").trim();
      }
    }

    _label(entity_id) {
      const found = this._sensors.find((s) => s.entity_id === entity_id);
      return found?.attributes?.friendly_name || entity_id;
    }

    _is_power(sensor) {
      const unit = String(sensor?.attributes?.unit_of_measurement || "").toLowerCase();
      const dc = String(sensor?.attributes?.device_class || "").toLowerCase();
      const eid = String(sensor?.entity_id || "").toLowerCase();
      if (dc === "power") return true;
      if (unit === "w" || unit === "kw") return true;
      if (eid.includes("_power") || eid.includes("puissance")) return true;
      return false;
    }

    _is_facture_total(sensor) {
      return String(sensor?.entity_id || "").toLowerCase().includes("facture_total_");
    }

    _is_cost_daily_ttc(sensor) {
      const eid = String(sensor?.entity_id || "").toLowerCase();
      return eid.includes("_cout_daily") && eid.includes("_ttc");
    }

    async load_sensors() {
      const count_el = this._("hse_cards_sensor_count");
      const rooms_count_el = this._("hse_cards_rooms_count");
      try {
        const [sensors, enriched] = await Promise.all([
          window.hse_cards_api.fetch_lovelace_sensors(this._hass),
          window.hse_cards_api.fetch_sensors_enriched(this._hass).catch(() => null),
        ]);
        this._sensors = sensors;
        this._sensors_enriched = enriched || sensors;

        if (count_el) {
          count_el.textContent = sensors.length > 0 ? sensors.length : "Aucun trouvé";
          count_el.classList.toggle("hse_badge_error", sensors.length === 0);
        }

        if (rooms_count_el) {
          const rooms = new Set(
            (this._sensors_enriched || []).map((s) => s.room_name).filter(Boolean)
          );
          rooms_count_el.textContent = rooms.size > 0 ? rooms.size : "0 (configurer Customisation)";
          rooms_count_el.classList.toggle("hse_badge_error", rooms.size === 0);
        }
      } catch (err) {
        console.error("[HSE cards] erreur chargement sensors:", err);
        if (count_el) {
          count_el.textContent = `Erreur: ${err.message}`;
          count_el.classList.add("hse_badge_error");
        }
      }
    }

    _apply_card_type_visibility() {
      const type_el = this._("hse_cards_card_type");
      const card_type = type_el ? type_el.value : "by_room";

      const pf_el = this._("hse_cards_pf_options");
      const sensor_el = this._("hse_cards_sensor_options");
      const room_el = this._("hse_cards_room_options");

      if (pf_el) pf_el.style.display = card_type === "power_flow_card_plus" ? "" : "none";
      if (sensor_el) sensor_el.style.display = card_type === "sensor" ? "" : "none";
      if (room_el) room_el.style.display = card_type === "by_room" ? "" : "none";
    }

    _populate_selects() {
      const power_sensors = this._sensors.filter((s) => this._is_power(s));
      const facture_total = this._sensors.filter((s) => this._is_facture_total(s));
      this._pf_all_facture_total = facture_total;

      const power_opts = power_sensors
        .map((s) => ({ entity_id: s.entity_id, label: s.attributes?.friendly_name || s.entity_id }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));

      this._fill_select("hse_cards_pf_grid_power", power_opts, "— Choisir —", true);
      this._fill_select("hse_cards_pf_home_power", power_opts, "— Aucun (optionnel) —", false);
      this._render_home_cost_options();
      this._refresh_individual_options();

      const all_sensors_opts = this._sensors
        .map((s) => ({ entity_id: s.entity_id, label: s.attributes?.friendly_name || s.entity_id }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));
      this._fill_select("hse_cards_sensor_entity", all_sensors_opts, "— Choisir un capteur —", true);
    }

    _fill_select(id, options, empty_label, required) {
      const el = this._(id);
      if (!el) return;
      const cur = el.value;
      el.innerHTML = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = empty_label;
      el.appendChild(empty);
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.entity_id;
        o.textContent = opt.label;
        el.appendChild(o);
      }
      if (cur && options.some((o) => o.entity_id === cur)) el.value = cur;
    }

    _render_home_cost_options() {
      const cost_el = this._("hse_cards_pf_home_cost");
      const kw_el = this._("hse_cards_pf_cost_keyword");
      if (!cost_el) return;

      const cur = String(cost_el.value || "");
      const keyword = kw_el ? this._normalize(kw_el.value) : "";

      let candidates = this._pf_all_facture_total || [];
      if (keyword) {
        candidates = candidates.filter((s) => {
          const eid = String(s.entity_id || "").toLowerCase();
          return eid.includes(`facture_total_${keyword}`) || eid.includes(keyword);
        });
      }

      const options = candidates
        .map((s) => ({ entity_id: s.entity_id, label: s.attributes?.friendly_name || s.entity_id }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));

      cost_el.innerHTML = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— Aucun (optionnel) —";
      cost_el.appendChild(empty);
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.entity_id;
        o.textContent = opt.label;
        cost_el.appendChild(o);
      }

      if (cur && options.some((o) => o.entity_id === cur)) { cost_el.value = cur; return; }
      if (!cur && options.length === 1) { cost_el.value = options[0].entity_id; return; }
      if (!keyword) this._suggest_home_cost_from_title();
    }

    _suggest_home_cost_from_title() {
      const cost_el = this._("hse_cards_pf_home_cost");
      const title_el = this._("hse_cards_pf_title");
      const kw_el = this._("hse_cards_pf_cost_keyword");
      if (!cost_el || !title_el) return;
      if (kw_el && this._normalize(kw_el.value)) return;
      const title = this._normalize(title_el.value);
      if (!title) return;
      const words = title.split(" ").filter((w) => w.length >= 3);
      for (const w of words) {
        const match = (this._pf_all_facture_total || []).find((s) =>
          String(s.entity_id || "").toLowerCase().includes(`facture_total_${w}`)
        );
        if (match && !cost_el.value) { cost_el.value = match.entity_id; return; }
      }
      if (!cost_el.value) cost_el.value = "";
    }

    _refresh_individual_options() {
      const container = this._("hse_cards_pf_individuals");
      if (!container) return;

      const power_sensors = this._sensors.filter((s) => this._is_power(s));
      const cost_sensors = this._sensors.filter((s) => this._is_cost_daily_ttc(s));

      const all_power = power_sensors
        .map((s) => ({ entity_id: s.entity_id, label: s.attributes?.friendly_name || s.entity_id }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));

      const all_cost = cost_sensors
        .map((s) => ({ entity_id: s.entity_id, label: s.attributes?.friendly_name || s.entity_id }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));

      container.querySelectorAll(".hse_cards_individual_row").forEach((row_el) => {
        const pkw_el = row_el.querySelector("input[data-role='power_kw']");
        const ckw_el = row_el.querySelector("input[data-role='cost_kw']");
        const p_el = row_el.querySelector("select[data-role='power']");
        const c_el = row_el.querySelector("select[data-role='cost']");

        const pkw = pkw_el ? this._normalize(pkw_el.value) : "";
        const ckw = ckw_el ? this._normalize(ckw_el.value) : "";

        const power_opts = pkw ? all_power.filter((o) => this._normalize(o.label).includes(pkw) || o.entity_id.toLowerCase().includes(pkw)) : all_power;
        const cost_opts = ckw ? all_cost.filter((o) => this._normalize(o.label).includes(ckw) || o.entity_id.toLowerCase().includes(ckw)) : all_cost;

        if (p_el) {
          const cur = p_el.value;
          p_el.innerHTML = "";
          const e = document.createElement("option"); e.value = ""; e.textContent = "— Choisir —"; p_el.appendChild(e);
          for (const o of power_opts) { const opt = document.createElement("option"); opt.value = o.entity_id; opt.textContent = o.label; p_el.appendChild(opt); }
          if (cur && power_opts.some((o) => o.entity_id === cur)) p_el.value = cur;
        }

        if (c_el) {
          const cur = c_el.value;
          c_el.innerHTML = "";
          const e = document.createElement("option"); e.value = ""; e.textContent = "— Aucun (optionnel) —"; c_el.appendChild(e);
          for (const o of cost_opts) { const opt = document.createElement("option"); opt.value = o.entity_id; opt.textContent = o.label; c_el.appendChild(opt); }
          if (cur && cost_opts.some((o) => o.entity_id === cur)) c_el.value = cur;
        }
      });
    }

    _add_individual_row() {
      const container = this._("hse_cards_pf_individuals");
      if (!container) return;

      this._pf_row_seq++;
      const row = document.createElement("div");
      row.className = "hse_cards_individual_row hse_card";
      row.dataset.rowId = String(this._pf_row_seq);
      row.innerHTML = `
        <div class="hse_cards_grid">
          <div class="hse_cards_field">
            <label class="hse_label">Recherche puissance</label>
            <input class="hse_input" type="text" data-role="power_kw" placeholder="mot-clé (tv, pc, clim…)" />
          </div>
          <div class="hse_cards_field">
            <label class="hse_label">Puissance</label>
            <select class="hse_select" data-role="power"></select>
          </div>
          <div class="hse_cards_field">
            <label class="hse_label">Recherche coût</label>
            <input class="hse_input" type="text" data-role="cost_kw" placeholder="mot-clé (cout, ttc…)" />
          </div>
          <div class="hse_cards_field">
            <label class="hse_label">Coût (optionnel)</label>
            <select class="hse_select" data-role="cost"></select>
          </div>
        </div>
        <button type="button" class="hse_button hse_button_danger hse_cards_individual_remove">🗑️ Supprimer</button>
      `;

      row.querySelector(".hse_cards_individual_remove").addEventListener("click", () => row.remove());
      row.querySelector("input[data-role='power_kw']").addEventListener("input", () => this._refresh_individual_options());
      row.querySelector("input[data-role='cost_kw']").addEventListener("input", () => this._refresh_individual_options());

      container.appendChild(row);
      this._refresh_individual_options();
    }

    generate_yaml() {
      if (!this._sensors.length) { alert("Aucun sensor HSE trouvé. Vérifiez que vos sensors sont créés."); return; }

      const type_el = this._("hse_cards_card_type");
      const card_type = type_el ? type_el.value : "by_room";

      if (card_type === "by_room") {
        const room_filter = String(this._("hse_cards_room_filter")?.value || "").trim();
        const enriched = this._sensors_enriched.length ? this._sensors_enriched : this._sensors;
        const rooms_with_assign = enriched.filter((s) => s.room_name);
        if (!rooms_with_assign.length && !room_filter) {
          alert("Aucune affectation de pièce trouvée.\n\nConfigurez les pièces dans l'onglet Customisation puis relancez la génération.");
          return;
        }
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: enriched,
          cardTypes: ["by_room"],
          options: { room_filter },
        });

      } else if (card_type === "power_flow_card_plus") {
        const title = String(this._("hse_cards_pf_title")?.value || "").trim();
        const grid_power = String(this._("hse_cards_pf_grid_power")?.value || "").trim();
        const home_power = String(this._("hse_cards_pf_home_power")?.value || "").trim();
        const home_cost = String(this._("hse_cards_pf_home_cost")?.value || "").trim();

        if (!grid_power) { alert("Power Flow: Grid puissance obligatoire"); return; }

        const individuals = [];
        const container = this._("hse_cards_pf_individuals");
        if (container) {
          container.querySelectorAll(".hse_cards_individual_row").forEach((row_el) => {
            const p_el = row_el.querySelector("select[data-role='power']");
            const c_el = row_el.querySelector("select[data-role='cost']");
            const power_entity = String(p_el?.value || "").trim();
            const cost_entity = String(c_el?.value || "").trim();
            if (power_entity) individuals.push({ power_entity, cost_entity, name: this._label(power_entity) });
          });
        }

        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors,
          cardTypes: ["power_flow_card_plus"],
          options: { title, grid: { power_entity: grid_power }, home: { power_entity: home_power, cost_entity: home_cost }, individuals },
        });

      } else if (card_type === "sensor") {
        const sensor_entity_id = String(this._("hse_cards_sensor_entity")?.value || "").trim();
        if (!sensor_entity_id) { alert("Capteur individuel: choisissez un capteur."); return; }
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors,
          cardTypes: ["sensor"],
          options: { sensor_entity_id },
        });

      } else if (card_type === "distribution") {
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors,
          cardTypes: ["distribution"],
          options: {},
        });

      } else if (card_type === "multi_sensor") {
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors,
          cardTypes: ["multi_sensor"],
          options: {},
        });

      } else {
        const daily = this._sensors
          .filter((s) => { const eid = s.entity_id; return eid.includes("_d") || eid.includes("daily") || eid.includes("_day"); })
          .sort((a, b) => parseFloat(b.state || 0) - parseFloat(a.state || 0))
          .slice(0, 10);
        const to_use = daily.length ? daily : this._sensors.sort((a, b) => parseFloat(b.state || 0) - parseFloat(a.state || 0)).slice(0, 10);
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({ sensors: to_use, cardTypes: ["overview"], options: {} });
      }

      const yaml_el = this._("hse_cards_yaml_code");
      if (yaml_el) yaml_el.textContent = this._yaml;

      const last_gen_el = this._("hse_cards_last_gen");
      if (last_gen_el) last_gen_el.textContent = new Date().toLocaleString("fr-FR");
    }

    async copy_yaml() {
      if (!this._yaml) { alert("Générez d'abord le YAML"); return; }
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(this._yaml);
          alert("YAML copié dans le presse-papiers !");
        } else {
          const ta = document.createElement("textarea");
          ta.value = this._yaml;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          alert("YAML copié dans le presse-papiers !");
        }
      } catch (err) {
        alert("Erreur lors de la copie : " + err.message);
      }
    }

    download_yaml() {
      if (!this._yaml) { alert("Générez d'abord le YAML"); return; }
      const blob = new Blob([this._yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `hse_dashboard_${Date.now()}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    }

    toggle_preview() {
      const pv = this._("hse_cards_preview_container");
      const btn = this._("hse_cards_btn_preview");
      if (!pv) return;

      const visible = pv.style.display !== "none";
      if (visible) {
        pv.style.display = "none";
        if (btn) btn.textContent = "\u{1F441}\uFE0F Aperçu";
      } else {
        pv.style.display = "";
        if (btn) btn.textContent = "\u274C Fermer aperçu";
        this._render_preview();
      }
    }

    _render_preview() {
      const grid = this._("hse_cards_preview_grid");
      if (!grid) return;

      if (!this._sensors.length) { grid.innerHTML = '<p class="hse_hint">Aucun sensor disponible</p>'; return; }

      const daily = this._sensors
        .filter((s) => { const eid = s.entity_id || ""; return eid.includes("_d") || eid.includes("daily") || eid.includes("_day"); })
        .sort((a, b) => parseFloat(b.state || 0) - parseFloat(a.state || 0))
        .slice(0, 10);

      const to_show = daily.length ? daily : this._sensors.slice(0, 10);

      grid.innerHTML = to_show.map((s) => {
        const state = parseFloat(s.state || 0).toFixed(2);
        const unit = s.attributes?.unit_of_measurement || "kWh";
        const name = s.attributes?.friendly_name || s.entity_id;
        return `<div class="hse_card hse_cards_preview_card">
          <div class="hse_label" title="${s.entity_id}">${name}</div>
          <div class="hse_value">${state} <span class="hse_unit">${unit}</span></div>
        </div>`;
      }).join("");
    }

    attach_events() {
      const _on = (id, event, fn) => {
        const el = this._(id);
        if (!el) { console.warn(`[HSE cards] attach_events: #${id} not found in shadowRoot`); return; }
        el.addEventListener(event, fn);
      };

      _on("hse_cards_btn_generate", "click", () => this.generate_yaml());
      _on("hse_cards_btn_copy", "click", () => this.copy_yaml());
      _on("hse_cards_btn_download", "click", () => this.download_yaml());
      _on("hse_cards_btn_preview", "click", () => this.toggle_preview());
      _on("hse_cards_refresh", "click", async () => {
        await this.load_sensors();
        this._populate_selects();
      });
      _on("hse_cards_card_type", "change", () => this._apply_card_type_visibility());
      _on("hse_cards_pf_title", "input", () => this._suggest_home_cost_from_title());
      _on("hse_cards_pf_cost_keyword", "input", () => this._render_home_cost_options());
      _on("hse_cards_pf_add_individual", "click", () => this._add_individual_row());
    }

    async init() {
      this.attach_events();
      await this.load_sensors();
      this._apply_card_type_visibility();
      this._populate_selects();

      const container = this._("hse_cards_pf_individuals");
      if (container && container.children.length === 0) {
        this._add_individual_row();
      }

      this._suggest_home_cost_from_title();
    }
  }

  CardsController.prototype._ = CardsController.prototype._$;

  function render_cards(container, hass) {
    if (!window.hse_cards_view || !window.hse_cards_yaml || !window.hse_cards_api) {
      container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Erreur: dépendances cards non chargées.</div></div>';
      return;
    }

    const shadow_root = container.getRootNode();

    // ── GUARD PRINCIPAL : si l'instance existe ET que le DOM est déjà construit,
    // on se contente de mettre à jour _hass sans rien reconstruire.
    // Cela empêche tout rechargement intempestif des champs lors des
    // mises à jour périodiques de hass (set hass → _render → render_cards).
    if (_instance && container.hasAttribute("data-hse-cards-dom-ready")) {
      _instance._hass = hass;
      return;
    }

    if (!(shadow_root instanceof ShadowRoot)) {
      console.error("[HSE cards] getRootNode() n'est pas un ShadowRoot — impossible d'attacher les événements.");
      return;
    }

    container.innerHTML = window.hse_cards_view.render_cards_layout();
    container.setAttribute("data-hse-cards-dom-ready", "1");

    if (_instance) {
      // Instance existante mais DOM détruit (changement d'onglet) : on réattache
      _instance._hass = hass;
      _instance._root = shadow_root;
      _instance.attach_events();
      _instance._apply_card_type_visibility();
      _instance._populate_selects();

      const yaml_el = shadow_root.getElementById("hse_cards_yaml_code");
      if (yaml_el && _instance._yaml) yaml_el.textContent = _instance._yaml;

      const last_gen_el = shadow_root.getElementById("hse_cards_last_gen");
      if (last_gen_el && _instance._last_gen) last_gen_el.textContent = _instance._last_gen;

      const count_el = shadow_root.getElementById("hse_cards_sensor_count");
      if (count_el && _instance._sensors.length) count_el.textContent = _instance._sensors.length;

      const rooms_count_el = shadow_root.getElementById("hse_cards_rooms_count");
      if (rooms_count_el && _instance._sensors_enriched.length) {
        const rooms = new Set((_instance._sensors_enriched || []).map((s) => s.room_name).filter(Boolean));
        rooms_count_el.textContent = rooms.size > 0 ? rooms.size : "0 (configurer Customisation)";
      }

      const pv = shadow_root.getElementById("hse_cards_preview_container");
      if (pv && _instance._preview_open) {
        pv.style.display = "";
        const btn = shadow_root.getElementById("hse_cards_btn_preview");
        if (btn) btn.textContent = "\u274C Fermer aperçu";
        _instance._render_preview();
      }
      return;
    }

    const ctrl = new CardsController(hass, shadow_root);

    // Sauvegarde de l'état de prévisualisation sur l'instance pour restauration
    Object.defineProperty(ctrl, "_preview_open", {
      get() {
        const pv = this._root?.getElementById("hse_cards_preview_container");
        return pv ? pv.style.display !== "none" : false;
      },
      enumerable: false,
    });

    // Sauvegarde de la date de dernière génération
    const _orig_generate = ctrl.generate_yaml.bind(ctrl);
    ctrl.generate_yaml = function () {
      _orig_generate();
      const last_gen_el = this._("hse_cards_last_gen");
      if (last_gen_el && last_gen_el.textContent !== "Jamais") {
        this._last_gen = last_gen_el.textContent;
      }
    };

    _instance = ctrl;
    ctrl.init().catch((err) => console.error("[HSE cards] init error:", err));
  }

  window.hse_cards_controller = { render_cards };
})();
