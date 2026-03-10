(function () {
  const { el, clear } = window.hse_dom;

  // ─── LocalStorage helpers ───────────────────────────────────────────────────
  function _ls_get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }
  function _ls_set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  // ─── Formatters ─────────────────────────────────────────────────────────────
  function _num(x) {
    const v = Number.parseFloat(String(x));
    return Number.isFinite(v) ? v : null;
  }
  function _fmt_kwh(x)       { const v = _num(x); return v == null ? "—" : `${v.toFixed(3)} kWh`; }
  function _fmt_eur(x)       { const v = _num(x); return v == null ? "—" : `${v.toFixed(2)} €`; }
  function _fmt_pct(x)       { const v = _num(x); if (v == null) return "—"; return `${v > 0 ? "+" : ""}${v.toFixed(1)} %`; }
  function _fmt_delta_kwh(x) { const v = _num(x); if (v == null) return "—"; return `${v > 0 ? "+" : ""}${v.toFixed(3)} kWh`; }
  function _fmt_delta_eur(x) { const v = _num(x); if (v == null) return "—"; return `${v > 0 ? "+" : ""}${v.toFixed(2)} €`; }

  // ─── Preferences ────────────────────────────────────────────────────────────
  function _display_mode(pricing) {
    const saved = String(_ls_get("hse_costs_tax_mode") || "").toLowerCase();
    if (saved === "ht" || saved === "ttc") return saved;
    return String(pricing?.display_mode || "ttc").toLowerCase() === "ht" ? "ht" : "ttc";
  }
  function _set_display_mode(mode) { _ls_set("hse_costs_tax_mode", mode === "ht" ? "ht" : "ttc"); }

  function _subtab() {
    const v = String(_ls_get("hse_costs_subtab") || "period").toLowerCase();
    return v === "compare" ? "compare" : "period";
  }
  function _set_subtab(v) { _ls_set("hse_costs_subtab", v === "compare" ? "compare" : "period"); }

  // ── Period preset ────────────────────────────────────────────────────────────
  function _period_preset() {
    const v = String(_ls_get("hse_costs_period_preset") || "today").toLowerCase();
    return ["today","yesterday","7days","30days","this_month","last_month"].includes(v) ? v : "today";
  }
  function _set_period_preset(v) { _ls_set("hse_costs_period_preset", v); }

  // ── Compare preset ───────────────────────────────────────────────────────────
  function _compare_preset() {
    const v = String(_ls_get("hse_costs_compare_preset") || "today_vs_yesterday").toLowerCase();
    return ["today_vs_yesterday","this_week_vs_last_week","this_weekend_vs_last_weekend","custom"].includes(v) ? v : "today_vs_yesterday";
  }
  function _set_compare_preset(v) { _ls_set("hse_costs_compare_preset", v); }

  function _week_mode()              { return String(_ls_get("hse_costs_week_mode") || "classic") === "custom" ? "custom" : "classic"; }
  function _set_week_mode(v)         { _ls_set("hse_costs_week_mode", v === "custom" ? "custom" : "classic"); }
  function _custom_week_start()      { const r = Number.parseInt(String(_ls_get("hse_costs_custom_week_start") || "1"), 10); return Number.isFinite(r) && r >= 0 && r <= 6 ? r : 1; }
  function _set_custom_week_start(v) { _ls_set("hse_costs_custom_week_start", String(v)); }

  function _get_custom_compare_ranges() {
    const now = new Date();
    const dre = now; const drs = _shift_days(now, -7);
    const dce = drs; const dcs = _shift_days(dce, -7);
    return {
      refStart: _ls_get("hse_costs_custom_ref_start")  || _datetime_local_value(drs),
      refEnd:   _ls_get("hse_costs_custom_ref_end")    || _datetime_local_value(dre),
      cmpStart: _ls_get("hse_costs_custom_cmp_start")  || _datetime_local_value(dcs),
      cmpEnd:   _ls_get("hse_costs_custom_cmp_end")    || _datetime_local_value(dce),
    };
  }

  // ─── Labels contextuels ──────────────────────────────────────────────────────
  function _compare_labels(preset) {
    if (preset === "today_vs_yesterday")          return { ref: "Aujourd'hui",   cmp: "Hier" };
    if (preset === "this_week_vs_last_week")       return { ref: "Cette semaine", cmp: "Semaine dernière" };
    if (preset === "this_weekend_vs_last_weekend") return { ref: "Ce weekend",    cmp: "Weekend dernier" };
    return { ref: "Période 1", cmp: "Période 2" };
  }

  // ─── Date utilities ──────────────────────────────────────────────────────────
  function _start_of_day(d)   { const r = new Date(d); r.setHours(0,0,0,0); return r; }
  function _end_of_day(d)     { const r = new Date(d); r.setHours(23,59,59,999); return r; }
  function _shift_days(d, n)  { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
  function _start_of_week(d, sd) {
    const r = _start_of_day(d); const diff = (r.getDay() - sd + 7) % 7;
    return _shift_days(r, -diff);
  }
  function _datetime_local_value(d) {
    const r = new Date(d); const p = (n) => String(n).padStart(2,"0");
    return `${r.getFullYear()}-${p(r.getMonth()+1)}-${p(r.getDate())}T${p(r.getHours())}:${p(r.getMinutes())}`;
  }
  function _datetime_from_local(v) {
    if (!v) return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d : null;
  }
  function _fmt_range(s, e) {
    const opts = { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" };
    const fmt = (d) => new Intl.DateTimeFormat("fr-FR", opts).format(d);
    return s && e ? `${fmt(s)} → ${fmt(e)}` : "—";
  }

  // Map period preset → dashboard period key
  function _preset_to_period_key(preset) {
    if (preset === "today" || preset === "yesterday") return "day";
    if (preset === "7days")      return "week";
    if (preset === "30days")     return "month";
    if (preset === "this_month") return "month";
    if (preset === "last_month") return "month";
    return "day";
  }

  // Resolve compare ranges
  function _compare_ranges(preset, weekMode, customWeekStart, now) {
    const sd = weekMode === "custom" ? customWeekStart : 1;
    if (preset === "this_week_vs_last_week") {
      const rs = _start_of_week(now, sd); const re = new Date(now);
      const cs = _shift_days(rs, -7); const ce = new Date(cs.getTime() + (re - rs));
      return { ref:[rs,re], cmp:[cs,ce] };
    }
    if (preset === "this_weekend_vs_last_weekend") {
      const jsDay = now.getDay(); const satOff = (jsDay - 6 + 7) % 7;
      const rs = _start_of_day(_shift_days(now, -satOff));
      if (jsDay === 6 || jsDay === 0) {
        const re = new Date(now); const cs = _shift_days(rs,-7); const ce = new Date(cs.getTime() + (re - rs));
        return { ref:[rs,re], cmp:[cs,ce] };
      }
      const re = _end_of_day(_shift_days(rs,1)); const cs = _shift_days(rs,-7); const ce = _end_of_day(_shift_days(cs,1));
      return { ref:[rs,re], cmp:[cs,ce] };
    }
    if (preset === "custom") {
      const c = _get_custom_compare_ranges();
      return { ref:[_datetime_from_local(c.refStart), _datetime_from_local(c.refEnd)], cmp:[_datetime_from_local(c.cmpStart), _datetime_from_local(c.cmpEnd)] };
    }
    const rs = _start_of_day(now); const re = new Date(now);
    const cs = _shift_days(rs,-1); const ce = new Date(cs.getTime() + (re - rs));
    return { ref:[rs,re], cmp:[cs,ce] };
  }

  // ─── UI atoms ────────────────────────────────────────────────────────────────
  function _pill_title(text) { return el("div", "hse_pill_title", text); }
  function _mk_toggle_button(label, active, onClick) {
    const btn = el("button", "hse_button", label);
    btn.disabled = !!active;
    btn.addEventListener("click", onClick);
    return btn;
  }
  function _row_total(row, mode) { return mode === "ht" ? row?.total_ht : row?.total_ttc; }

  function _mk_delta_badge(pct) {
    const v = _num(pct);
    if (v == null) return null;
    const abs = Math.abs(v);
    let bg, fg, icon;
    if (abs < 5) {
      bg = "rgba(128,128,128,0.12)"; fg = "var(--secondary-text-color,#888)"; icon = "≈";
    } else if (abs < 15) {
      bg = "rgba(230,126,34,0.15)"; fg = "#e67e22"; icon = v > 0 ? "▲" : "▼";
    } else {
      const up = v > 0;
      bg = up ? "rgba(231,76,60,0.15)" : "rgba(39,174,96,0.15)";
      fg = up ? "#e74c3c" : "#27ae60";
      icon = up ? "▲" : "▼";
    }
    const badge = el("span", null);
    badge.style.cssText = `display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:20px;background:${bg};color:${fg};font-weight:600;font-size:0.82em;`;
    badge.textContent = `${icon} ${_fmt_pct(v)}`;
    return badge;
  }

  // ─── Bloc 2 sous-lignes générique (compteur ref + capteurs) ─────────────────
  // name       : texte du titre
  // refKwh/refCost : données période de référence (ligne bleue)
  // cmpKwh/cmpCost : données période de comparaison (ligne rouge, null = pas de 2e barre/ligne)
  // maxCost    : valeur max pour les barres proportionnelles
  // labelRef   : libellé ligne 1
  // labelCmp   : libellé ligne 2 (null = pas de 2e ligne ni 2e barre)
  // isTitle    : true → bloc compteur (padding plus généreux)
  function _mk_two_line_row({
    name, subtitle,
    refKwh, refCost,
    cmpKwh, cmpCost,
    maxCost,
    labelRef, labelCmp,
    showBar = true,
    isTitle = false,
  }) {
    const maxV = _num(maxCost);

    const wrap = el("div", null);
    wrap.style.cssText = isTitle
      ? "padding:6px 4px 8px;"
      : "padding:8px 4px;border-bottom:1px solid rgba(128,128,128,0.1);";

    // Nom
    if (name) {
      const nameEl = el("div", null);
      nameEl.style.cssText = isTitle
        ? "font-size:0.95em;font-weight:600;margin-bottom:2px;"
        : "font-size:0.9em;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:4px;";
      nameEl.textContent = name;
      wrap.appendChild(nameEl);
      if (subtitle) {
        const subEl = el("div", null, subtitle);
        subEl.style.cssText = "font-size:0.78em;opacity:0.6;margin-bottom:4px;";
        wrap.appendChild(subEl);
      }
    }

    // ── Double barre proportionnelle ─────────────────────────────────────────
    const rc = _num(refCost);
    const cc = _num(cmpCost);
    if (showBar && maxV && maxV > 0) {
      const barGroup = el("div", null);
      barGroup.style.cssText = "display:flex;flex-direction:column;gap:2px;margin-bottom:5px;";

      // Barre bleue (période de référence / actuelle)
      if (rc != null) {
        const pct = Math.min(100, (rc / maxV) * 100);
        const track = el("div", null);
        track.style.cssText = "height:3px;background:rgba(128,128,128,0.15);border-radius:2px;";
        const fill = el("div", null);
        fill.style.cssText = `height:100%;width:${pct}%;background:var(--primary-color,#4caf50);border-radius:2px;`;
        track.appendChild(fill);
        barGroup.appendChild(track);
      }

      // Barre rouge (période de comparaison) — uniquement si labelCmp fourni
      if (cc != null && labelCmp) {
        const pct2 = Math.min(100, (cc / maxV) * 100);
        const track2 = el("div", null);
        track2.style.cssText = "height:3px;background:rgba(128,128,128,0.15);border-radius:2px;";
        const fill2 = el("div", null);
        fill2.style.cssText = `height:100%;width:${pct2}%;background:#e74c3c;border-radius:2px;opacity:0.7;`;
        track2.appendChild(fill2);
        barGroup.appendChild(track2);
      }

      wrap.appendChild(barGroup);
    }

    // Largeur de l'étiquette (cohérente entre les deux lignes)
    const lblW = isTitle ? "auto" : "100px";

    // Ligne 1 (période de référence)
    const row1 = el("div", null);
    row1.style.cssText = `display:flex;align-items:center;gap:6px;font-size:${isTitle ? "0.9em" : "0.85em"};`;
    if (labelRef) {
      const l1 = el("span", null, labelRef + " :");
      l1.style.cssText = `opacity:0.55;min-width:${lblW};flex-shrink:0;`;
      row1.appendChild(l1);
    }
    const rKwh = _num(refKwh);
    if (rKwh != null) {
      const k = el("span", null, _fmt_kwh(rKwh)); k.style.cssText = "font-weight:700;"; row1.appendChild(k);
    }
    const c1El = el("span", null, `· ${_fmt_eur(rc)}`); c1El.style.cssText = "opacity:0.8;"; row1.appendChild(c1El);
    // Badge delta (seulement si on a les deux périodes)
    if (rc != null && cc != null) {
      let dpct = null;
      if (cc !== 0) dpct = ((rc - cc) / Math.abs(cc)) * 100;
      else if (rc > 0) dpct = 100;
      const b = dpct != null ? _mk_delta_badge(dpct) : null;
      if (b) { b.style.marginLeft = "4px"; row1.appendChild(b); }
    }
    wrap.appendChild(row1);

    // Ligne 2 (période de comparaison) — uniquement si labelCmp fourni
    if (labelCmp) {
      const row2 = el("div", null);
      row2.style.cssText = `display:flex;align-items:center;gap:6px;font-size:${isTitle ? "0.9em" : "0.85em"};margin-top:3px;opacity:0.6;`;
      const l2 = el("span", null, labelCmp + " :");
      l2.style.cssText = `min-width:${lblW};flex-shrink:0;`; row2.appendChild(l2);
      const ckwh = _num(cmpKwh);
      if (ckwh != null) {
        const k2 = el("span", null, _fmt_kwh(ckwh)); k2.style.cssText = "font-weight:700;"; row2.appendChild(k2);
      }
      const c2El = el("span", null, `· ${_fmt_eur(cc)}`); row2.appendChild(c2El);
      wrap.appendChild(row2);
    }

    return { wrap, refCostNum: rc };
  }

  // ─── Coverage block ──────────────────────────────────────────────────────────
  function _mk_coverage_block(refKwh1, intKwh1, refKwh2, intKwh2, labelRef, labelCmp) {
    const r1 = _num(refKwh1); const i1 = _num(intKwh1);
    const r2 = _num(refKwh2); const i2 = _num(intKwh2);
    if (r1 == null && r2 == null) return null;

    const cov = (ref, int_) => (ref && ref > 0 && int_ != null) ? Math.min(100, (int_ / ref) * 100) : null;
    const cov1 = cov(r1, i1); const cov2 = cov(r2, i2);
    const drift = (cov1 != null && cov2 != null) ? Math.abs(cov1 - cov2) : null;
    const hasDrift = drift != null && drift > 10;

    const wrap = el("div", null); wrap.style.cssText = "margin-top:8px;";
    const borderColor = hasDrift ? "#e67e22" : "rgba(128,128,128,0.3)";
    const bgColor     = hasDrift ? "rgba(230,126,34,0.08)" : "rgba(128,128,128,0.05)";
    const block = el("div", null);
    block.style.cssText = `padding:8px 14px;border-left:3px solid ${borderColor};background:${bgColor};border-radius:0 8px 8px 0;font-size:0.85em;`;

    const title = el("div", null);
    title.style.cssText = "font-weight:600;margin-bottom:4px;color:var(--secondary-text-color,#888);";
    title.textContent = "ℹ️ Couverture capteurs"; block.appendChild(title);

    const lRef = labelRef || "Période 1";
    const lCmp = labelCmp || "Période 2";

    const mkLine = (label, cov_, refV, intV) => {
      if (cov_ == null) return;
      const line = el("div", null);
      line.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:2px;";
      const labelEl = el("span", null, label + " : ");
      labelEl.style.cssText = "opacity:0.7;min-width:110px;"; line.appendChild(labelEl);
      const barTrack = el("div", null);
      barTrack.style.cssText = "flex:1;height:4px;background:rgba(128,128,128,0.2);border-radius:2px;overflow:hidden;";
      const barFill = el("div", null);
      const fillColor = cov_ > 90 ? "#27ae60" : cov_ > 65 ? "#e67e22" : "rgba(128,128,128,0.5)";
      barFill.style.cssText = `height:100%;width:${cov_}%;background:${fillColor};border-radius:2px;`;
      barTrack.appendChild(barFill); line.appendChild(barTrack);
      const pctEl = el("span", null, `${cov_.toFixed(0)} %`);
      pctEl.style.cssText = "font-weight:600;min-width:36px;text-align:right;"; line.appendChild(pctEl);
      const detail = el("span", null, `(${_fmt_kwh(intV)} / ${_fmt_kwh(refV)})`);
      detail.style.cssText = "opacity:0.55;font-size:0.9em;"; line.appendChild(detail);
      block.appendChild(line);
    };

    if (cov1 != null) mkLine(r2 != null ? lRef : "Couverture", cov1, r1, i1);
    if (cov2 != null) mkLine(lCmp, cov2, r2, i2);

    if (hasDrift) {
      const note = el("div", null);
      note.style.cssText = "margin-top:6px;font-size:0.82em;color:#e67e22;";
      note.textContent = `⚡ L'écart entre capteurs varie de ${drift.toFixed(0)} point(s) — un appareil non mesuré a peut-être changé de comportement.`;
      block.appendChild(note);
    } else if (cov1 != null) {
      const note = el("div", null);
      note.style.cssText = "margin-top:6px;font-size:0.82em;opacity:0.6;";
      note.textContent = cov1 < 65
        ? "Plusieurs appareils ne sont pas encore mesurés — c'est normal."
        : "Couverture stable entre les deux périodes.";
      block.appendChild(note);
    }
    wrap.appendChild(block);
    return wrap;
  }

  // ─── Render: header ──────────────────────────────────────────────────────────
  function _render_header(container, mode, onModeChange, subtab, onSubtabChange) {
    const card = el("div", "hse_card");
    card.appendChild(el("div", "hse_kpi_title", "📊 Analyse de coûts"));
    const top = el("div", "hse_card_header");
    const left = el("div", "hse_card_actions");
    left.appendChild(_mk_toggle_button("Période",     subtab === "period",  () => onSubtabChange("period")));
    left.appendChild(_mk_toggle_button("Comparaison", subtab === "compare", () => onSubtabChange("compare")));
    top.appendChild(left);
    const right = el("div", "hse_card_actions");
    right.appendChild(_mk_toggle_button("Vue HT",  mode === "ht",  () => onModeChange("ht")));
    right.appendChild(_mk_toggle_button("Vue TTC", mode === "ttc", () => onModeChange("ttc")));
    top.appendChild(right);
    card.appendChild(top);
    container.appendChild(card);
  }

  // ─── Render: period tab ──────────────────────────────────────────────────────
  function _render_period(container, dash, mode, rerender) {
    const preset    = _period_preset();
    const periodKey = _preset_to_period_key(preset);

    const ctrl = el("div", "hse_card");
    const presetRow = el("div", "hse_card_actions"); presetRow.style.cssText = "flex-wrap:wrap;";
    const presets = [
      ["today",      "Aujourd'hui"],
      ["yesterday",  "Hier"],
      ["7days",      "7 derniers jours"],
      ["30days",     "30 derniers jours"],
      ["this_month", "Ce mois"],
      ["last_month", "Mois précédent"],
    ];
    for (const [val, label] of presets) {
      presetRow.appendChild(_mk_toggle_button(label, preset === val, () => { _set_period_preset(val); rerender(); }));
    }
    ctrl.appendChild(presetRow);
    if (preset === "yesterday" || preset === "last_month") {
      const note = el("div", "hse_subtitle");
      note.style.cssText = "margin-top:6px;font-size:0.8em;opacity:0.6;";
      note.textContent = preset === "yesterday"
        ? "ℹ️ Fenêtre journalière glissante (données live). Pour une comparaison précise, utilisez l'onglet Comparaison."
        : "ℹ️ Fenêtre mensuelle glissante. Pour le mois calendaire précédent exact, utilisez l'onglet Comparaison.";
      ctrl.appendChild(note);
    }
    container.appendChild(ctrl);

    // ── Bloc compteur de référence ───────────────────────────────────────────
    const hasRef = !!(dash?.reference?.entity_id);
    if (hasRef) {
      const refRow = _find_period_row(dash?.reference_table, periodKey);
      const refKwh  = _num(refRow?.kwh);
      const refCost = _num(_row_total(refRow, mode));

      const refCard = el("div", "hse_card");
      refCard.appendChild(el("div", "hse_kpi_title", "🏠 " + (dash.reference.name || dash.reference.entity_id)));
      const { wrap } = _mk_two_line_row({
        name: null,
        refKwh, refCost,
        cmpKwh: null, cmpCost: null,
        maxCost: null,
        labelRef: null, labelCmp: null,
        showBar: false, isTitle: true,
      });
      clear(wrap);
      const valRow = el("div", null); valRow.style.cssText = "display:flex;gap:6px;align-items:baseline;padding:4px 4px 2px;";
      const bigKwh = el("span", null, _fmt_kwh(refKwh)); bigKwh.style.cssText = "font-size:1.3em;font-weight:700;";
      const costSpan = el("span", null, `· ${_fmt_eur(refCost)}`); costSpan.style.cssText = "font-size:1.05em;opacity:0.8;";
      valRow.appendChild(bigKwh); valRow.appendChild(costSpan);
      wrap.appendChild(valRow);
      refCard.appendChild(wrap);
      container.appendChild(refCard);
    }

    // ── Capteurs internes ─────────────────────────────────────────────────────
    const perSensor = Array.isArray(dash?.per_sensor_costs) ? dash.per_sensor_costs : [];
    const getSensorCost = (r) => {
      const m = mode === "ht" ? r.cost_ht : r.cost_ttc;
      return (m && typeof m === "object") ? _num(m[periodKey]) : _num(m);
    };
    const getSensorKwh = (r) => {
      const m = r.kwh;
      return (m && typeof m === "object") ? _num(m[periodKey]) : _num(m);
    };

    const sorted = perSensor.slice().sort((a,b) => (getSensorCost(b) || -1e9) - (getSensorCost(a) || -1e9));
    const maxCost = getSensorCost(sorted[0]);
    let totalIntKwh = 0; let totalIntCost = 0; let hasAnyKwh = false;

    if (sorted.length) {
      const intCard = el("div", "hse_card");
      const intHead = el("div", "hse_card_header");
      intHead.appendChild(el("div", "hse_kpi_title", "🔌 Capteurs internes"));
      const intTotBadge = el("span", null); intTotBadge.style.cssText = "font-size:0.9em;opacity:0.75;";
      intHead.appendChild(intTotBadge);
      intCard.appendChild(intHead);

      const list = el("div", null);
      for (const r of sorted) {
        const cost = getSensorCost(r);
        const kwh  = getSensorKwh(r);
        if (cost != null) totalIntCost += cost;
        if (kwh  != null) { totalIntKwh += kwh; hasAnyKwh = true; }
        const { wrap } = _mk_two_line_row({
          name: r.name || r.entity_id || "—",
          refKwh: kwh, refCost: cost,
          cmpKwh: null, cmpCost: null,
          maxCost, labelRef: null, labelCmp: null,
          showBar: true, isTitle: false,
        });
        list.appendChild(wrap);
      }

      const totalRow = el("div", null);
      totalRow.style.cssText = "display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 4px 2px;font-weight:600;font-size:0.9em;border-top:1px solid rgba(128,128,128,0.2);";
      totalRow.appendChild(el("div", null, "Total mesuré"));
      totalRow.appendChild(el("div", null, _fmt_eur(totalIntCost)));
      list.appendChild(totalRow);
      intCard.appendChild(list);

      intTotBadge.textContent = hasAnyKwh
        ? `${_fmt_kwh(totalIntKwh)}  ${_fmt_eur(totalIntCost)}`
        : _fmt_eur(totalIntCost);

      const refKwh1 = hasRef ? _num(_find_period_row(dash?.reference_table, periodKey)?.kwh) : null;
      const covBlock = _mk_coverage_block(refKwh1, hasAnyKwh ? totalIntKwh : null, null, null, "Couverture", null);
      if (covBlock) intCard.appendChild(covBlock);
      container.appendChild(intCard);
    } else if (!hasRef) {
      const empty = el("div", "hse_card");
      empty.appendChild(el("div", "hse_subtitle", "Aucune donnée disponible."));
      container.appendChild(empty);
    }
  }

  // ─── Render: compare tab ─────────────────────────────────────────────────────
  async function _render_compare(container, dash, mode, rerender, hass) {
    const preset          = _compare_preset();
    const weekMode        = _week_mode();
    const customWeekStart = _custom_week_start();
    const now             = new Date();
    const { ref, cmp }    = _compare_ranges(preset, weekMode, customWeekStart, now);
    const labels          = _compare_labels(preset);

    // ── Controls ──────────────────────────────────────────────────────────────
    const ctrl = el("div", "hse_card");
    const presetRow = el("div", "hse_card_actions"); presetRow.style.cssText = "flex-wrap:wrap;";
    const presetsMap = [
      ["today_vs_yesterday",          "Auj. vs Hier"],
      ["this_week_vs_last_week",       "Cette semaine vs Dernière"],
      ["this_weekend_vs_last_weekend", "Ce weekend vs Dernier"],
      ["custom",                       "Personnalisé"],
    ];
    for (const [val, label] of presetsMap) {
      presetRow.appendChild(_mk_toggle_button(label, preset === val, () => { _set_compare_preset(val); rerender(); }));
    }
    ctrl.appendChild(presetRow);

    if (preset === "this_week_vs_last_week") {
      const wr = el("div", "hse_card_actions");
      wr.appendChild(_mk_toggle_button("Lundi–Dimanche", weekMode === "classic", () => { _set_week_mode("classic"); rerender(); }));
      wr.appendChild(_mk_toggle_button("Début custom",   weekMode === "custom",  () => { _set_week_mode("custom");  rerender(); }));
      ctrl.appendChild(wr);
      if (weekMode === "custom") {
        const wrap = el("div", "hse_toolbar"); wrap.appendChild(el("div", "hse_subtitle", "Début de semaine"));
        const select = document.createElement("select"); select.className = "hse_input";
        ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"].forEach((n,i) => {
          const o = document.createElement("option"); o.value = String(i); o.textContent = n;
          o.selected = i === customWeekStart; select.appendChild(o);
        });
        select.addEventListener("change", () => { _set_custom_week_start(Number.parseInt(select.value,10)); Promise.resolve().then(() => rerender()); });
        wrap.appendChild(select); ctrl.appendChild(wrap);
      }
    }

    if (preset === "custom") {
      const c = _get_custom_compare_ranges();
      const pCard = el("div", "hse_card hse_card_compact"); pCard.style.cssText = "margin-top:8px;";
      const mkInput = (label, key, value) => {
        const row = el("div", "hse_toolbar"); row.appendChild(el("div", "hse_subtitle", label));
        const input = document.createElement("input"); input.type = "datetime-local"; input.className = "hse_input"; input.value = value || "";
        input.addEventListener("change", () => { _ls_set(key, input.value || ""); });
        row.appendChild(input); pCard.appendChild(row);
      };
      mkInput("Période 1 — début", "hse_costs_custom_ref_start", c.refStart);
      mkInput("Période 1 — fin",   "hse_costs_custom_ref_end",   c.refEnd);
      mkInput("Période 2 — début", "hse_costs_custom_cmp_start", c.cmpStart);
      mkInput("Période 2 — fin",   "hse_costs_custom_cmp_end",   c.cmpEnd);
      const applyBtn = el("button", "hse_button hse_button_primary", "🔍 Comparer");
      applyBtn.style.cssText = "margin-top:8px;";
      applyBtn.addEventListener("click", () => rerender());
      pCard.appendChild(applyBtn); ctrl.appendChild(pCard);
    }

    const lbl1 = el("div", "hse_subtitle"); lbl1.style.cssText = "margin-top:6px;font-size:0.82em;opacity:0.7;";
    lbl1.textContent = `${labels.ref} : ${_fmt_range(ref[0], ref[1])}`; ctrl.appendChild(lbl1);
    const lbl2 = el("div", "hse_subtitle"); lbl2.style.cssText = "font-size:0.82em;opacity:0.7;";
    lbl2.textContent = `${labels.cmp} : ${_fmt_range(cmp[0], cmp[1])}`; ctrl.appendChild(lbl2);
    container.appendChild(ctrl);

    const loadingCard = el("div", "hse_card hse_card_compact");
    loadingCard.appendChild(el("div", "hse_subtitle", "Calcul en cours…"));
    container.appendChild(loadingCard);

    let resp = null;
    try {
      resp = await hass.callApi("POST", "hse/unified/costs/compare", {
        preset: preset === "custom" ? "custom_periods" : preset,
        tax_mode: mode,
        week_mode: weekMode,
        custom_week_start: customWeekStart,
        ...(preset === "custom" ? (() => {
          const c = _get_custom_compare_ranges();
          return { reference_range: { start: c.refStart, end: c.refEnd }, compare_range: { start: c.cmpStart, end: c.cmpEnd } };
        })() : {}),
      });
    } catch (err) {
      clear(loadingCard);
      loadingCard.appendChild(el("div", "hse_kpi_title", "Erreur"));
      loadingCard.appendChild(el("div", "hse_subtitle", String(err?.message || err || "compare_failed")));
      return;
    }

    clear(loadingCard);

    if (!resp || resp.ok !== true || resp.supported === false) {
      loadingCard.appendChild(el("div", "hse_kpi_title", "Comparaison indisponible"));
      loadingCard.appendChild(el("div", "hse_subtitle", "Le backend n'a pas pu résoudre cette comparaison."));
      return;
    }

    const refPeriod = resp.reference_period || {};
    const cmpPeriod = resp.compare_period   || {};
    const summary   = resp.summary          || {};
    const pctKey    = mode === "ht" ? "pct_total_ht" : "pct_total_ttc";

    // ── Bloc compteur de référence — double barre bleue/rouge ─────────────────
    const hasRef = !!(dash?.reference?.entity_id);
    if (hasRef) {
      const refCard = el("div", "hse_card");
      const refHead = el("div", "hse_card_header");
      refHead.appendChild(el("div", "hse_kpi_title", "🏠 " + (dash.reference.name || dash.reference.entity_id)));
      const refPct   = _num(summary?.reference?.[pctKey]);
      const refBadge = _mk_delta_badge(refPct);
      if (refBadge) refHead.appendChild(refBadge);
      refCard.appendChild(refHead);

      const refCostVal = _num(_row_total(refPeriod?.reference, mode));
      const cmpCostVal = _num(_row_total(cmpPeriod?.reference, mode));
      // maxCost pour les barres du compteur = max(ref, cmp)
      const refMaxCost = Math.max(refCostVal || 0, cmpCostVal || 0) || null;

      const { wrap: refWrap } = _mk_two_line_row({
        name: null,
        subtitle: "Compteur — valeur réelle totale du foyer",
        refKwh:  _num(refPeriod?.reference?.kwh),
        refCost: refCostVal,
        cmpKwh:  _num(cmpPeriod?.reference?.kwh),
        cmpCost: cmpCostVal,
        maxCost: refMaxCost,
        labelRef: labels.ref, labelCmp: labels.cmp,
        showBar: true, isTitle: true,
      });
      refCard.appendChild(refWrap);

      // Ligne écart
      const dKwh  = _num(summary?.reference?.delta_kwh);
      const dCost = _num(summary?.reference?.[mode === "ht" ? "delta_total_ht" : "delta_total_ttc"]);
      if (dKwh != null || dCost != null) {
        const dLine = el("div", null); dLine.style.cssText = "font-size:0.82em;margin-top:2px;padding:0 4px 6px;opacity:0.6;";
        const parts = [];
        if (dKwh  != null) parts.push(_fmt_delta_kwh(dKwh));
        if (dCost != null) parts.push(_fmt_delta_eur(dCost));
        dLine.textContent = `Écart : ${parts.join("  ")}`;
        refCard.appendChild(dLine);
      }
      container.appendChild(refCard);
    }

    // ── Capteurs internes ─────────────────────────────────────────────────────
    const perSensor = Array.isArray(resp.per_sensor) ? resp.per_sensor : [];
    const hasAnySensorData = perSensor.some((r) => _num(_row_total(r?.reference_period, mode)) != null);

    const sorted = perSensor.slice().sort((a,b) =>
      (_num(_row_total(b?.reference_period, mode)) || -1e9) - (_num(_row_total(a?.reference_period, mode)) || -1e9)
    );
    const maxCostP1 = _num(_row_total(sorted[0]?.reference_period, mode));

    let totalInt1Cost = 0; let totalInt1Kwh = 0;
    let totalInt2Cost = 0; let totalInt2Kwh = 0;
    for (const r of sorted) {
      const c1 = _num(_row_total(r?.reference_period, mode));
      const c2 = _num(_row_total(r?.compare_period,   mode));
      const k1 = _num(r?.reference_period?.kwh);
      const k2 = _num(r?.compare_period?.kwh);
      if (c1 != null) totalInt1Cost += c1;
      if (c2 != null) totalInt2Cost += c2;
      if (k1 != null) totalInt1Kwh  += k1;
      if (k2 != null) totalInt2Kwh  += k2;
    }

    const intCard = el("div", "hse_card");
    const intHead = el("div", "hse_card_header");
    intHead.appendChild(el("div", "hse_kpi_title", "🔌 Capteurs internes"));
    const intPct   = _num(summary?.internal?.[pctKey]);
    const intBadge = _mk_delta_badge(intPct);
    if (intBadge) intHead.appendChild(intBadge);
    intCard.appendChild(intHead);

    if (!hasAnySensorData) {
      const info = el("div", null);
      info.style.cssText = "padding:10px 4px;font-size:0.88em;opacity:0.75;line-height:1.6;";
      info.innerHTML = "Les données historiques par capteur ne sont pas encore disponibles.<br>" +
        "<strong>Cause probable :</strong> les entités <code>*_kwh_total</code> ne sont pas encore enregistrées " +
        "dans les statistiques Home Assistant (recorder).<br>" +
        "Les capteurs doivent accumuler au moins quelques heures d'historique pour que la comparaison soit possible.";
      intCard.appendChild(info);
    } else {
      const list = el("div", null);
      for (const r of sorted) {
        const c1 = _num(_row_total(r?.reference_period, mode));
        const c2 = _num(_row_total(r?.compare_period,   mode));
        const k1 = _num(r?.reference_period?.kwh);
        const k2 = _num(r?.compare_period?.kwh);
        const { wrap } = _mk_two_line_row({
          name: r.name || r.entity_id || "—",
          refKwh: k1, refCost: c1,
          cmpKwh: k2, cmpCost: c2,
          maxCost: maxCostP1,
          labelRef: labels.ref, labelCmp: labels.cmp,
          showBar: true, isTitle: false,
        });
        list.appendChild(wrap);
      }

      // Total ligne 1 (ref)
      const totalRow = el("div", null);
      totalRow.style.cssText = "padding:8px 4px 2px;font-weight:600;font-size:0.88em;border-top:1px solid rgba(128,128,128,0.2);display:flex;align-items:center;gap:8px;";
      const totLabel = el("div", null, "Total mesuré"); totLabel.style.cssText = "flex:1;";
      totalRow.appendChild(totLabel);
      const totRef = el("span", null, _fmt_eur(totalInt1Cost)); totRef.style.cssText = "font-weight:700;"; totalRow.appendChild(totRef);
      if (totalInt2Cost > 0) {
        const tp = ((totalInt1Cost - totalInt2Cost) / Math.abs(totalInt2Cost)) * 100;
        const b = _mk_delta_badge(tp);
        if (b) { b.style.marginLeft = "6px"; totalRow.appendChild(b); }
      }
      list.appendChild(totalRow);
      // Total ligne 2 (cmp)
      const totalRow2 = el("div", null);
      totalRow2.style.cssText = "padding:2px 4px 6px;font-size:0.82em;opacity:0.6;display:flex;gap:8px;";
      totalRow2.appendChild(el("div", null, `${labels.cmp} : ${_fmt_eur(totalInt2Cost)}`));
      list.appendChild(totalRow2);

      intCard.appendChild(list);

      const refKwh1 = hasRef ? _num(refPeriod?.reference?.kwh) : null;
      const refKwh2 = hasRef ? _num(cmpPeriod?.reference?.kwh) : null;
      const covBlock = _mk_coverage_block(refKwh1, totalInt1Kwh, refKwh2, totalInt2Kwh, labels.ref, labels.cmp);
      if (covBlock) intCard.appendChild(covBlock);
    }
    container.appendChild(intCard);
  }

  // ─── Helper ──────────────────────────────────────────────────────────────────
  function _find_period_row(rows, period) {
    const arr = Array.isArray(rows) ? rows : [];
    return arr.find((r) => r?.period === period) || null;
  }

  // ─── Main entry point ────────────────────────────────────────────────────────
  function render_costs(container, data, hass) {
    clear(container);
    const dash = data?.dashboard || null;
    if (!dash || dash.ok !== true) {
      const card = el("div", "hse_card");
      card.appendChild(_pill_title("Analyse de coûts"));
      card.appendChild(el("div", "hse_subtitle", "Impossible de charger les données de coût."));
      container.appendChild(card);
      return;
    }

    const pricing = dash.pricing || dash.defaults || {};
    const mode    = _display_mode(pricing);
    const subtab  = _subtab();

    let _raf_pending = false;
    const rerender = () => {
      if (_raf_pending) return;
      _raf_pending = true;
      window.requestAnimationFrame(() => {
        _raf_pending = false;
        render_costs(container, data, hass);
      });
    };

    _render_header(
      container, mode,
      (m) => { _set_display_mode(m); rerender(); },
      subtab,
      (s) => { _set_subtab(s); rerender(); }
    );

    if (subtab === "compare") {
      _render_compare(container, dash, mode, rerender, hass);
    } else {
      _render_period(container, dash, mode, rerender);
    }
  }

  window.hse_costs_view = { render_costs };
})();
