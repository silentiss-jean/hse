(function () {
  "use strict";

  /**
   * Génère le layout HTML complet de l'onglet Génération de cartes.
   * @returns {string} HTML
   */
  function render_cards_layout() {
    return `
      <div class="hse_cards_layout">

        <!-- Hero -->
        <div class="hse_cards_hero">
          <div class="hse_cards_hero_left">
            <div class="hse_section_title">🎨 Génération de cartes Lovelace</div>
            <div class="hse_subtitle">Génère un YAML prêt à coller dans un dashboard Home Assistant, avec un aperçu rapide.</div>
          </div>
          <div class="hse_cards_hero_right">
            <button id="hse_cards_refresh" class="hse_button">🔄 Actualiser</button>
          </div>
        </div>

        <!-- Meta -->
        <div class="hse_card hse_cards_meta">
          <div class="hse_cards_meta_item">
            <span class="hse_label">Sensors HSE détectés</span>
            <span id="hse_cards_sensor_count" class="hse_badge">Chargement…</span>
          </div>
          <div class="hse_cards_meta_item">
            <span class="hse_label">Dernière génération</span>
            <span id="hse_cards_last_gen" class="hse_badge">Jamais</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="hse_toolbar">
          <button id="hse_cards_btn_generate" class="hse_button hse_button_primary">⚡ Générer</button>
          <button id="hse_cards_btn_preview" class="hse_button">👁️ Aperçu</button>
          <button id="hse_cards_btn_copy" class="hse_button">📋 Copier</button>
          <button id="hse_cards_btn_download" class="hse_button">📥 Télécharger</button>
        </div>

        <!-- Config -->
        <div class="hse_card">
          <div class="hse_section_title">⚙️ Configuration</div>
          <div class="hse_subtitle">Choisir le type de carte et les entités. Les champs coût sont facultatifs.</div>

          <div class="hse_cards_field">
            <label class="hse_label" for="hse_cards_card_type">Type de carte</label>
            <select id="hse_cards_card_type" class="hse_select">
              <option value="overview" selected>Overview (historique)</option>
              <option value="power_flow_card_plus">Power Flow Card Plus</option>
            </select>
          </div>

          <!-- Options Power Flow (masquées par défaut) -->
          <div id="hse_cards_pf_options" style="display:none">
            <div class="hse_cards_grid">

              <div class="hse_cards_field">
                <label class="hse_label" for="hse_cards_pf_title">Titre</label>
                <input id="hse_cards_pf_title" class="hse_input" type="text" placeholder="Chambre" />
              </div>

              <div class="hse_cards_field">
                <label class="hse_label" for="hse_cards_pf_grid_power">Grid: puissance (obligatoire)</label>
                <select id="hse_cards_pf_grid_power" class="hse_select"></select>
              </div>

              <div class="hse_cards_field">
                <label class="hse_label" for="hse_cards_pf_home_power">Home: puissance (optionnel)</label>
                <select id="hse_cards_pf_home_power" class="hse_select"></select>
              </div>

              <div class="hse_cards_field">
                <label class="hse_label" for="hse_cards_pf_cost_keyword">Home: mot-clé coût total</label>
                <input id="hse_cards_pf_cost_keyword" class="hse_input" type="text" placeholder="ex: chambre / chauffage / clim" />
                <div class="hse_hint">Filtre les sensors <code>*facture_total_*</code>. Si vide, auto-suggestion via le titre.</div>
              </div>

              <div class="hse_cards_field">
                <label class="hse_label" for="hse_cards_pf_home_cost">Home: coût total (optionnel)</label>
                <select id="hse_cards_pf_home_cost" class="hse_select"></select>
              </div>

            </div>

            <!-- Individuals -->
            <div class="hse_cards_individuals_wrap">
              <div class="hse_toolbar">
                <span class="hse_label">Individuals</span>
                <button id="hse_cards_pf_add_individual" class="hse_button" type="button">➕ Ajouter un individual</button>
              </div>
              <div id="hse_cards_pf_individuals"></div>
              <div class="hse_hint">Chaque ligne: recherche + sélection puissance, recherche + sélection coût (facultatif).</div>
            </div>
          </div>
        </div>

        <!-- YAML Output -->
        <div class="hse_card">
          <div class="hse_section_title">📝 Code YAML</div>
          <div class="hse_hint">Astuce: copier puis coller dans un nouveau dashboard, puis adapter si besoin.</div>
          <pre id="hse_cards_yaml_code" class="hse_code" style="min-height:80px">Cliquez sur "Générer" pour commencer…</pre>
        </div>

        <!-- Aperçu (masqué par défaut) -->
        <div id="hse_cards_preview_container" style="display:none">
          <div class="hse_card">
            <div class="hse_section_title">👁️ Aperçu</div>
            <div class="hse_hint">Aperçu simplifié (affichage rapide), pas un rendu Lovelace 1:1.</div>
            <div id="hse_cards_preview_grid" class="hse_cards_preview_grid"></div>
          </div>
        </div>

      </div>
    `;
  }

  window.hse_cards_view = { render_cards_layout };
})();
