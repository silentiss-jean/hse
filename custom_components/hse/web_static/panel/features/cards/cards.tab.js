/* cards.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.cards
   Dépend de : hse_cards_controller (expose window.hse_cards_controller.render_cards)

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   fix #4 — update_hass ne déclenche plus render_cards.
   render_cards n'est appelé qu'au mount initial.
   hass est stocké dans _hass pour usage interne futur.
   cards.controller.js gère son propre état interne (_instance CardsController).
*/
(function () {
  window.hse_tabs_registry = window.hse_tabs_registry || {};
  if (window.hse_tabs_registry.cards) return;

  let _container = null;
  let _hass      = null;

  window.hse_tabs_registry.cards = {
    mount(container, ctx) {
      _container = container;
      _hass      = ctx.hass;
      if (window.hse_cards_controller?.render_cards) {
        window.hse_cards_controller.render_cards(_container, _hass);
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module génération cartes en cours de chargement…</div></div>';
      }
    },

    update_hass(hass) {
      // fix #4 : stocke uniquement, pas de re-render
      // cards.controller gère son propre cycle de vie
      _hass = hass;
    },

    unmount() {
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: cards registered');
})();
