(function () {
  const { el, clear } = window.hse_dom;

  function render_placeholder(container, title, subtitle) {
    clear(container);
    const card = el("div", "hse_card");
    card.appendChild(el("div", null, title));
    card.appendChild(el("div", "hse_subtitle", subtitle || "À venir."));
    container.appendChild(card);
  }

  window.hse_placeholder_view = { render_placeholder };
})();
