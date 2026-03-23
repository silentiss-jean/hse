(function () {
  "use strict";

  function render_cards_layout() {
    return `
<div class="hse_section">
  <div class="hse_section_title">🃏 Génération de cartes Lovelace</div>
  <div class="hse_section_subtitle">Génère un YAML prêt à coller dans un dashboard Home Assistant.</div>
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
  <button id="hse_cards_btn_copy" class="hse_button">📋 Copier</button>
  <button id="hse_cards_btn_download" class="hse_button">💾 Télécharger</button>
  <button id="hse_cards_refresh" class="hse_button hse_button_secondary">🔄 Actualiser</button>
</div>

<!-- ────── Configuration ────── -->
<div class="hse_card">
  <div class="hse_section_title">⚙️ Configuration</div>
  <div class="hse_section_subtitle">Choisissez le type de carte à générer.</div>

  <div class="hse_cards_field">
    <label class="hse_label">Type de carte</label>
    <select id="hse_cards_card_type" class="hse_select">
      <option value="distribution">Distribution de puissance</option>
      <option value="sensor">Capteur individuel (sensor)</option>
      <option value="power_flow_card_plus">⚡ Power Flow Card Plus (auto)</option>
    </select>
  </div>

  <!-- Options capteur individuel -->
  <div id="hse_cards_sensor_options" style="display:none; margin-top:12px;">
    <div class="hse_cards_field">
      <label class="hse_label">Capteur</label>
      <select id="hse_cards_sensor_entity" class="hse_select"></select>
    </div>
  </div>

  <!-- Info Power Flow auto -->
  <div id="hse_cards_pf_options" style="display:none; margin-top:12px;">
    <div class="hse_section_subtitle">
      ⚡ Généré automatiquement depuis vos pièces configurées.<br>
      Les affectations pièce/sensor se configurent dans l'onglet <strong>Customisation</strong>.
    </div>
  </div>
</div>

<!-- ────── Code YAML ────── -->
<div class="hse_card">
  <div class="hse_section_title">📝 Code YAML</div>
  <div class="hse_section_subtitle">Copiez ce YAML et collez-le dans un nouveau dashboard Home Assistant.</div>
  <pre id="hse_cards_yaml_code" class="hse_code">Cliquez sur "Générer" pour commencer…</pre>
</div>
`;
  }

  window.hse_cards_view = { render_cards_layout };
})();
