/*
HSE_DOC: custom_components/hse/docs/table_js.md
HSE_MAINTENANCE: If you change table rendering contract (columns API, placeholder, classes), update the doc above.
*/

(function () {
  const { el, clear } = window.hse_dom;

  function render_table(container, columns, rows) {
    clear(container);

    const table = el("table", "hse_table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");

    for (const col of columns) {
      trh.appendChild(el("th", null, col.label));
    }
    thead.appendChild(trh);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const col of columns) {
        const td = document.createElement("td");
        const value = col.get_value(row);
        td.textContent = value === undefined || value === null ? "—" : String(value);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
  }

  window.hse_table = { render_table };
})();
