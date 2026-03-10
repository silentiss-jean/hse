/*
HSE_DOC: custom_components/hse/docs/dom_js.md
HSE_MAINTENANCE: If you change exported helpers or DOM creation rules, update the doc above.
*/

(function () {
  function el(tag, class_name, text) {
    const node = document.createElement(tag);
    if (class_name) node.className = class_name;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  window.hse_dom = { el, clear };
})();
