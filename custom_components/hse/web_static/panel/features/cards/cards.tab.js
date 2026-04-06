/* cards.tab.js — module tab uniforme (contrat mount/update_hass/unmount)
   S'enregistre dans window.hse_tabs_registry.cards
   Dépend de : hse_cards_controller (expose window.hse_cards_controller.render_cards)

   Contrat ctx : { hass, panel, actions, live_store, live_service }

   API réelle exposée par cards.controller.js :
     window.hse_cards_controller.render_cards(container, hass)

   cards.controller.js gère son propre état interne (_instance CardsController) :
     - Au premier mount : crée l'instance, injecte le layout HTML, attache les events
     - Aux mounts suivants (retour d'onglet) : réutilise l'instance, réattache les events
     - update_hass : met à jour _instance._hass directement
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
      _hass = hass;
      // render_cards gère la mise à jour hass en interne via le guard _instance check
      if (_container && window.hse_cards_controller?.render_cards) {
        window.hse_cards_controller.render_cards(_container, hass);
      }
    },

    unmount() {
      _container = null;
      _hass      = null;
    },
  };

  console.info('[HSE] tab module: cards registered');
})();
