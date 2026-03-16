(function () {
  "use strict";

  function render_cards_layout() {
    return `
<div class="hse_section">
  <div class="hse_section_title">🃏 Génération de cartes Lovelace</div>
  <div class="hse_section_subtitle">Génère un YAML prêt à coller dans un dashboard Home Assistant, avec un aperçu rapide.</div>
</div>

<div class="hse_card">
  <div class="hse_cards_grid">
    <div class="hse_cards_stat">
      <span class="hse_label">Sensors HSE détectés</span>
      <span id="hse_cards_sensor_count" class="hse_badge">Chargement…</span>
    </div>
    <div class="hse_cards_stat">
      <span class="hse_label">Dernière génération</span>
      <span id="hse_cards_last_gen" class="hse_badge">Jamais</span>
    </div>
    <div class="hse_cards_stat">
      <span class="hse_label">Pièces avec affectations</span>
      <span id="hse_cards_rooms_count" class="hse_badge">—</span>
    </div>
  </div>
</div>

<div class="hse_toolbar">
  <button id="hse_cards_btn_generate" class="hse_button hse_button_primary">⚡ Générer</button>
  <button id="hse_cards_btn_preview" class="hse_button">👁️ Aperçu</button>
  <button id="hse_cards_btn_copy" class="hse_button">📋 Copier</button>
  <button id="hse_cards_btn_download" class="hse_button">💾 Télécharger</button>
  <button id="hse_cards_refresh" class="hse_button hse_button_secondary">🔄 Actualiser</button>
</div>

<!-- ────── Configuration ────── -->
<div class="hse_card">
  <div class="hse_section_title">⚙️ Configuration</div>
  <div class="hse_section_subtitle">Choisir le type de carte et les entités. Les champs coût sont facultatifs.</div>

  <div class="hse_cards_field">
    <label class="hse_label">Type de carte</label>
    <select id="hse_cards_card_type" class="hse_select">
      <option value="by_room">🏠 Par pièce (auto — recommandé)</option>
      <option value="overview">Overview (historique)</option>
      <option value="distribution">Distribution de puissance</option>
      <option value="sensor">Capteur individuel (sensor)</option>
      <option value="multi_sensor">Grille multi-capteurs kWh/jour</option>
      <option value="power_flow_card_plus">Power Flow Card Plus (custom)</option>
    </select>
  </div>

  <!-- Options Par pièce -->
  <div id="hse_cards_room_options" style="margin-top:12px;">
    <div class="hse_cards_field">
      <label class="hse_label">Filtrer par pièce (optionnel)</label>
      <input id="hse_cards_room_filter" class="hse_input" type="text"
        placeholder="cuisine, chambre, buanderie… (vide = toutes les pièces)" />
    </div>
    <div class="hse_section_subtitle" style="margin-top:6px;">
      💡 Laissez vide pour générer un dashboard complet (une vue par pièce).
      Les affectations pièce/icône se configurent dans l'onglet <strong>Customisation</strong>.
    </div>
  </div>

  <!-- Options capteur individuel -->
  <div id="hse_cards_sensor_options" style="display:none; margin-top:12px;">
    <div class="hse_cards_field">
      <label class="hse_label">Capteur</label>
      <select id="hse_cards_sensor_entity" class="hse_select"></select>
    </div>
  </div>

  <!-- Options Power Flow -->
  <div id="hse_cards_pf_options" style="display:none; margin-top:12px;">
    <div class="hse_cards_grid">
      <div class="hse_cards_field">
        <label class="hse_label">Titre (optionnel)</label>
        <input id="hse_cards_pf_title" class="hse_input" type="text" placeholder="Ma maison…" />
      </div>
      <div class="hse_cards_field">
        <label class="hse_label">Grid — Puissance (obligatoire)</label>
        <select id="hse_cards_pf_grid_power" class="hse_select"></select>
      </div>
      <div class="hse_cards_field">
        <label class="hse_label">Home — Puissance (optionnel)</label>
        <select id="hse_cards_pf_home_power" class="hse_select"></select>
      </div>
      <div class="hse_cards_field">
        <label class="hse_label">Recherche coût (filtre)</label>
        <input id="hse_cards_pf_cost_keyword" class="hse_input" type="text" placeholder="mot-clé facture…" />
      </div>
      <div class="hse_cards_field">
        <label class="hse_label">Home — Coût facture (optionnel)</label>
        <select id="hse_cards_pf_home_cost" class="hse_select"></select>
      </div>
    </div>

    <div class="hse_section_title" style="margin-top:16px;">Appareils individuels</div>
    <div id="hse_cards_pf_individuals"></div>
    <button id="hse_cards_pf_add_individual" class="hse_button hse_button_secondary" style="margin-top:8px;">➕ Ajouter un appareil</button>
  </div>
</div>

<!-- ────── Code YAML ────── -->
<div class="hse_card">
  <div class="hse_section_title">📝 Code YAML</div>
  <div class="hse_section_subtitle">Astuce: copier puis coller dans un nouveau dashboard, puis adapter si besoin.</div>
  <pre id="hse_cards_yaml_code" class="hse_code">Cliquez sur "Générer" pour commencer…</pre>
</div>

<!-- ────── Aperçu ────── -->
<div id="hse_cards_preview_container" style="display:none;">
  <div class="hse_card">
    <div class="hse_section_title">👁️ Aperçu</div>
    <div class="hse_section_subtitle">Aperçu simplifié (affichage rapide), pas un rendu Lovelace 1:1.</div>
    <div id="hse_cards_preview_grid" class="hse_cards_preview_grid"></div>
  </div>
</div>
`;
  }

  window.hse_cards_view = { render_cards_layout };
})();
