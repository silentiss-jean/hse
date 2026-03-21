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
    }

    _$(id) {
      return this._root.getElementById(id);
    }

    _label(entity_id) {
      const found = this._sensors.find((s) => s.entity_id === entity_id);
      return found?.attributes?.friendly_name || entity_id;
    }

    async load_sensors() {
      const count_el = this._$("hse_cards_sensor_count");
      const rooms_count_el = this._$("hse_cards_rooms_count");
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
      const type_el = this._$("hse_cards_card_type");
      const card_type = type_el ? type_el.value : "distribution";

      const pf_el = this._$("hse_cards_pf_options");
      const sensor_el = this._$("hse_cards_sensor_options");

      if (pf_el) pf_el.style.display = card_type === "power_flow_card_plus" ? "" : "none";
      if (sensor_el) sensor_el.style.display = card_type === "sensor" ? "" : "none";
    }

    _populate_sensor_select() {
      const all_opts = this._sensors
        .map((s) => ({ entity_id: s.entity_id, label: s.attributes?.friendly_name || s.entity_id }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr"));

      const sel = this._$("hse_cards_sensor_entity");
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "— Choisir un capteur —";
      sel.appendChild(empty);
      for (const opt of all_opts) {
        const o = document.createElement("option");
        o.value = opt.entity_id;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      if (cur && all_opts.some((o) => o.entity_id === cur)) sel.value = cur;
    }

    generate_yaml() {
      if (!this._sensors.length) {
        alert("Aucun sensor HSE trouvé. Vérifiez que vos sensors sont créés.");
        return;
      }

      const type_el = this._$("hse_cards_card_type");
      const card_type = type_el ? type_el.value : "distribution";

      if (card_type === "power_flow_card_plus") {
        // Passe les sensors enrichis — le composer fait le groupage auto par room_id
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors_enriched.length ? this._sensors_enriched : this._sensors,
          cardTypes: ["power_flow_card_plus"],
          options: {},
        });

      } else if (card_type === "sensor") {
        const sensor_entity_id = String(this._$("hse_cards_sensor_entity")?.value || "").trim();
        if (!sensor_entity_id) { alert("Capteur individuel: choisissez un capteur."); return; }
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors,
          cardTypes: ["sensor"],
          options: { sensor_entity_id },
        });

      } else {
        // distribution (default)
        this._yaml = window.hse_cards_yaml.generate_dashboard_yaml({
          sensors: this._sensors,
          cardTypes: ["distribution"],
          options: {},
        });
      }

      const yaml_el = this._$("hse_cards_yaml_code");
      if (yaml_el) yaml_el.textContent = this._yaml;

      const last_gen_el = this._$("hse_cards_last_gen");
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
      a.download = `hse_card_${Date.now()}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    }

    attach_events() {
      const _on = (id, event, fn) => {
        const el = this._$(id);
        if (!el) { console.warn(`[HSE cards] attach_events: #${id} not found in shadowRoot`); return; }
        el.addEventListener(event, fn);
      };

      _on("hse_cards_btn_generate", "click", () => this.generate_yaml());
      _on("hse_cards_btn_copy", "click", () => this.copy_yaml());
      _on("hse_cards_btn_download", "click", () => this.download_yaml());
      _on("hse_cards_refresh", "click", async () => {
        await this.load_sensors();
        this._populate_sensor_select();
      });
      _on("hse_cards_card_type", "change", () => this._apply_card_type_visibility());
    }

    async init() {
      this.attach_events();
      await this.load_sensors();
      this._apply_card_type_visibility();
      this._populate_sensor_select();
    }
  }

  CardsController.prototype._ = CardsController.prototype._$;

  function render_cards(container, hass) {
    if (!window.hse_cards_view || !window.hse_cards_yaml || !window.hse_cards_api) {
      container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Erreur: dépendances cards non chargées.</div></div>';
      return;
    }

    const shadow_root = container.getRootNode();

    // ── GUARD PRINCIPAL : instance existante + DOM déjà construit → update hass uniquement
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
      // Instance existante mais DOM détruit (retour d'onglet) : réattachement
      _instance._hass = hass;
      _instance._root = shadow_root;
      _instance.attach_events();
      _instance._apply_card_type_visibility();
      _instance._populate_sensor_select();

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
      return;
    }

    const ctrl = new CardsController(hass, shadow_root);

    // Sauvegarde de la date de dernière génération pour restauration au retour d'onglet
    const _orig_generate = ctrl.generate_yaml.bind(ctrl);
    ctrl.generate_yaml = function () {
      _orig_generate();
      const last_gen_el = this._$("hse_cards_last_gen");
      if (last_gen_el && last_gen_el.textContent !== "Jamais") {
        this._last_gen = last_gen_el.textContent;
      }
    };

    _instance = ctrl;
    ctrl.init().catch((err) => console.error("[HSE cards] init error:", err));
  }

  window.hse_cards_controller = { render_cards };
})();
