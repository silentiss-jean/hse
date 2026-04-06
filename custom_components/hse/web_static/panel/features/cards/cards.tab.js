/* cards.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.cards
   Dépend de : hse_cards_view, hse_cards_controller

   Contrat ctx : { hass, panel, actions, live_store, live_service }
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
      if (window.hse_cards_view?.render_cards) {
        window.hse_cards_view.render_cards(container, _hass);
      } else if (window.hse_cards_controller?.render) {
        window.hse_cards_controller.render(container, _hass);
      } else {
        container.innerHTML = '<div class="hse_card"><div class="hse_subtitle">Module g\u00e9n\u00e9ration cartes en cours de chargement\u2026</div></div>';
      }
    },

    update_hass(hass) {
      _hass = hass;
      window.hse_cards_view?.update_hass?.(_container, hass);
      window.hse_cards_controller?.update_hass?.(_container, hass);
    },

    unmount() {
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: cards registered');
})();
