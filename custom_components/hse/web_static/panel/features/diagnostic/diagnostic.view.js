/* diagnostic.view.js */
(function () {
  const dom = () => window.hse_dom || {};

  function _el(tag, cls, text) {
    return dom().el(tag, cls, text);
  }

  function _clear(node) {
    return dom().clear(node);
  }

  function _triage_policy(item) {
    return String(((item || {}).triage || {}).policy || "normal").trim().toLowerCase() || "normal";
  }

  function _escalation(item) {
    return String(((item || {}).health || {}).escalation || "none").trim().toLowerCase() || "none";
  }

  function _parse_ts(value) {
    if (!value) return null;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }

  function _is_active_muted(item) {
    const mute_until = ((item || {}).triage || {}).mute_until;
    const ts = _parse_ts(mute_until);
    return ts != null && ts > Date.now();
  }

  function _is_alert_item(item) {
    const policy = _triage_policy(item);
    if (policy === "removed" || policy === "archived") return false;
    if (_is_active_muted(item)) return false;
    return _escalation(item) !== "none";
  }

  function _item_search_blob(item) {
    const src = (item || {}).source || {};
    const triage = (item || {}).triage || {};
    return [
      item?.id,
      src.entity_id,
      src.unique_id,
      src.config_entry_id,
      src.device_id,
      src.platform,
      src.integration_domain,
      triage.note,
      (item?.health || {}).reason,
      (item?.health || {}).escalation,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function _matches_query(item, q) {
    const needle = String(q || "").trim().toLowerCase();
    if (!needle) return true;
    return _item_search_blob(item).includes(needle);
  }

  function _filtered_escalated_items(data, q) {
    const itemsObj = (data || {}).items || {};
    const items = Object.entries(itemsObj)
      .filter(([, item]) => item && typeof item === "object")
      .map(([id, item]) => ({ ...item, id }));

    return items
      .filter((item) => _is_alert_item(item) && _matches_query(item, q))
      .sort((a, b) => {
        const ea = _escalation(a);
        const eb = _escalation(b);
        const rank = { error: 3, warning: 2, info: 1, none: 0 };
        const diff = (rank[eb] || 0) - (rank[ea] || 0);
        if (diff) return diff;
        const ae = String((a.source || {}).entity_id || "");
        const be = String((b.source || {}).entity_id || "");
        return ae.localeCompare(be) || String(a.id || "").localeCompare(String(b.id || ""));
      });
  }

  function _group_escalated_items(items) {
    const map = new Map();
    for (const item of items || []) {
      const entity_id = (item.source || {}).entity_id || "(sans entity_id)";
      const cur = map.get(entity_id) || { entity_id, items: [] };
      cur.items.push(item);
      map.set(entity_id, cur);
    }

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        count: group.items.length,
      }))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
  }

  function _local_iso_days_from_now(days) {
    const dd = new Date();
    dd.setDate(dd.getDate() + Number(days || 0));
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = dd.getFullYear();
    const mm = pad(dd.getMonth() + 1);
    const da = pad(dd.getDate());
    const hh = pad(dd.getHours());
    const mi = pad(dd.getMinutes());
    const ss = pad(dd.getSeconds());
    const tzMin = -dd.getTimezoneOffset();
    const sign = tzMin >= 0 ? "+" : "-";
    const tzAbs = Math.abs(tzMin);
    const tzh = pad(Math.floor(tzAbs / 60));
    const tzm = pad(tzAbs % 60);
    return `${yyyy}-${mm}-${da}T${hh}:${mi}:${ss}${sign}${tzh}:${tzm}`;
  }

  function _badge(text, tone) {
    const span = _el("span", "hse_badge");
    span.textContent = text;
    span.dataset.tone = tone || "neutral";
    return span;
  }

  function _button(text, className, onClick) {
    const btn = _el("button", className || "hse_button", text);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function _render_alert_group(card, group, state, on_action) {
    const title = _el("div", null, group.entity_id);
    const subtitle = _el("div", "hse_subtitle", `${group.count} alerte(s) visible(s)`);
    card.appendChild(title);
    card.appendChild(subtitle);

    for (const item of group.items) {
      const row = _el("div", "hse_card");
      row.style.marginTop = "10px";

      const top = _el("div", "hse_toolbar");
      const left = _el("label", null);
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!state?.selected?.[item.id];
      cb.addEventListener("change", () => on_action("select", { item_id: item.id, checked: cb.checked }));
      left.appendChild(cb);

      const src = item.source || {};
      const main = _el("span", null, `${item.id} · ${src.entity_id || "?"}`);
      left.appendChild(main);
      top.appendChild(left);

      const badges = _el("div", "hse_toolbar");
      badges.appendChild(_badge(_escalation(item), _escalation(item) === "error" ? "danger" : "warn"));
      badges.appendChild(_badge(_triage_policy(item), _triage_policy(item) === "normal" ? "neutral" : "info"));
      top.appendChild(badges);
      row.appendChild(top);

      const lines = [
        src.unique_id ? `unique_id: ${src.unique_id}` : null,
        src.config_entry_id ? `config_entry: ${src.config_entry_id}` : null,
        src.last_seen_at ? `last_seen: ${src.last_seen_at}` : null,
      ].filter(Boolean);
      row.appendChild(_el("div", "hse_subtitle", lines.join(" · ")));

      const actions = _el("div", "hse_toolbar");
      actions.appendChild(
        _button("Mute 7j", "hse_button", () =>
          on_action("mute", { item_id: item.id, mute_until: _local_iso_days_from_now(7) })
        )
      );
      actions.appendChild(
        _button("Removed", "hse_button", () => on_action("removed", { item_id: item.id }))
      );
      row.appendChild(actions);
      card.appendChild(row);
    }
  }

  function _render_check_result(container, state, on_action) {
    const wrap = _el("div", "hse_card");
    wrap.appendChild(_el("div", null, "Contrôle de cohérence"));

    if (state?.check_loading) {
      wrap.appendChild(_el("div", "hse_subtitle", "Analyse en cours…"));
      container.appendChild(wrap);
      return;
    }

    if (state?.check_error) {
      wrap.appendChild(_el("div", "hse_subtitle", `Erreur: ${state.check_error}`));
      container.appendChild(wrap);
      return;
    }

    const results = state?.check_result?.results || [];
    if (!results.length) {
      wrap.appendChild(_el("div", "hse_subtitle", "Aucun résultat de cohérence pour le moment."));
      container.appendChild(wrap);
      return;
    }

    const summary = state?.check_result?.summary || {};
    wrap.appendChild(
      _el(
        "div",
        "hse_subtitle",
        `checked=${summary.checked_count || 0} · warnings=${summary.warning_count || 0} · errors=${summary.error_count || 0}`
      )
    );

    for (const result of results) {
      const card = _el("div", "hse_card");
      card.style.marginTop = "10px";
      const top = _el("div", "hse_toolbar");
      top.appendChild(_el("div", null, result.entity_id || "(sans entity_id)"));
      top.appendChild(_badge(result.status || "ok", result.status === "error" ? "danger" : result.status === "warning" ? "warn" : "success"));
      card.appendChild(top);
      card.appendChild(_el("div", "hse_subtitle", `${result.reason_code || "no_issue"} · ${result.explanation || ""}`));

      const counts = result.counts || {};
      card.appendChild(
        _el(
          "div",
          "hse_subtitle",
          `items=${counts.catalogue_items_for_entity || 0} · opérationnels=${counts.operational_items || 0} · historiques=${counts.historical_items || 0} · archived=${counts.archived_items || 0} · removed=${counts.removed_items || 0} · active_entries=${counts.active_config_entries || 0}`
        )
      );

      if (result.current_item) {
        const current = result.current_item;
        card.appendChild(
          _el(
            "div",
            "hse_subtitle",
            `courant: ${current.item_id || "?"} · triage=${current.triage_policy || "normal"} · config_entry=${current.config_entry_id || "-"}`
          )
        );
      }

      const hist = Array.isArray(result.historical_items) ? result.historical_items : [];
      if (hist.length) {
        const histText = hist
          .map((x) => `${x.item_id}(${x.state || x.triage_policy || "historical"})`)
          .join(" · ");
        card.appendChild(_el("div", "hse_subtitle", `historique: ${histText}`));
      }

      const archiveIds = Array.isArray(result?.next_step?.archive_item_ids) ? result.next_step.archive_item_ids.filter(Boolean) : [];
      if (result?.next_step?.safe_to_auto_fix && archiveIds.length) {
        const actions = _el("div", "hse_toolbar");
        actions.appendChild(
          _button("Remettre en cohérence maintenant", "hse_button hse_button_primary", () =>
            on_action("consolidate_history", {
              entity_id: result.entity_id,
              item_ids: archiveIds,
              current_item_id: result?.current_item?.item_id || null,
            })
          )
        );
        card.appendChild(actions);
      }

      wrap.appendChild(card);
    }

    container.appendChild(wrap);
  }

  function render_diagnostic(container, data, state, on_action) {
    _clear(container);

    const toolbarCard = _el("div", "hse_card");
    const toolbar = _el("div", "hse_toolbar");

    const filter = document.createElement("input");
    filter.type = "search";
    filter.placeholder = "Filtrer (entity_id, unique_id, item_id…)";
    filter.value = state?.filter_q || "";
    filter.addEventListener("change", () => on_action("filter", filter.value));
    filter.addEventListener("keyup", (ev) => {
      if (ev.key === "Enter") on_action("filter", filter.value);
    });
    toolbar.appendChild(filter);

    toolbar.appendChild(_button("Rafraîchir", "hse_button", () => on_action("refresh")));
    toolbar.appendChild(_button("Contrôler cohérence", "hse_button hse_button_primary", () => on_action("check_coherence")));
    toolbar.appendChild(_button("Tout sélectionner", "hse_button", () => on_action("select_all_filtered")));
    toolbar.appendChild(_button("Aucun", "hse_button", () => on_action("select_none")));
    toolbar.appendChild(_button("Mute sélection 7j", "hse_button", () => on_action("bulk_mute", { mode: "selection", days: 7 })));
    toolbar.appendChild(_button("Removed sélection", "hse_button", () => on_action("bulk_removed", { mode: "selection" })));
    toolbar.appendChild(_button(state?.advanced ? "Debug −" : "Debug +", "hse_button", () => on_action("toggle_advanced")));

    toolbarCard.appendChild(toolbar);
    container.appendChild(toolbarCard);

    const filtered = _filtered_escalated_items(data, state?.filter_q || "");
    const groups = _group_escalated_items(filtered);
    const selectedCount = Object.keys(state?.selected || {}).filter((k) => state.selected[k]).length;

    const summary = _el("div", "hse_card");
    summary.appendChild(_el("div", null, "Alertes actives"));
    summary.appendChild(_el("div", "hse_subtitle", `visibles=${filtered.length} · groupes=${groups.length} · sélection=${selectedCount}`));
    container.appendChild(summary);

    if (!groups.length) {
      const empty = _el("div", "hse_card");
      empty.appendChild(_el("div", null, "Aucune alerte active"));
      empty.appendChild(_el("div", "hse_subtitle", "Les items removed, archived, ou encore mute ne remontent plus dans la liste principale."));
      container.appendChild(empty);
    } else {
      for (const group of groups) {
        const card = _el("div", "hse_card");
        _render_alert_group(card, group, state, on_action);
        container.appendChild(card);
      }
    }

    _render_check_result(container, state, on_action);

    if (state?.advanced) {
      const adv = _el("div", "hse_card");
      adv.appendChild(_el("div", null, "Debug"));
      adv.appendChild(_el("pre", "hse_code", JSON.stringify({
        last_action: state?.last_action || null,
        last_request: state?.last_request || null,
        last_response: state?.last_response || null,
      }, null, 2)));
      container.appendChild(adv);
    }
  }

  window.hse_diag_view = {
    _filtered_escalated_items,
    _group_escalated_items,
    _local_iso_days_from_now,
    render_diagnostic,
  };
})();
