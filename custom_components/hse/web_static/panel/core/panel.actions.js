/* panel.actions.js — logique métier extraite de hse_panel (phase 11) */
(function () {

  class HsePanelActions {
    constructor(panel) {
      this._p = panel; // référence au LitElement
    }

    get p() { return this._p; }

    // ── Helpers état ──────────────────────────────────────────────────────
    _dg(k)    { return window.hse_diag_state?.get(k); }
    _ds(k, v) { window.hse_diag_state?.set(k, v); }
    _cg(k)    { return window.hse_config_state?.get(k); }
    _cs(k, v) { window.hse_config_state?.set(k, v); }

    _err_msg(err) {
      if (!err) return '?';
      if (typeof err === 'string') return err;
      if (err.message) return String(err.message);
      try { return JSON.stringify(err); } catch (_) { return String(err); }
    }

    _storage_get(key) {
      try { return window.localStorage.getItem(key); } catch (_) { return null; }
    }

    _storage_set(key, value) {
      try { window.localStorage.setItem(key, value); } catch (_) {}
    }

    _deep_fill_missing(dst, src) {
      if (!dst || typeof dst !== 'object') return;
      if (!src || typeof src !== 'object') return;
      for (const k of Object.keys(src)) {
        const v = src[k], cur = dst[k];
        if (cur == null) {
          try { dst[k] = JSON.parse(JSON.stringify(v)); } catch (_) { dst[k] = v; }
          continue;
        }
        if (typeof cur === 'object' && typeof v === 'object' && cur && v && !Array.isArray(cur) && !Array.isArray(v)) {
          this._deep_fill_missing(cur, v);
        }
      }
    }

    _deep_set(obj, path, v) {
      if (!obj || typeof obj !== 'object') return;
      const parts = String(path || '').split('.').filter(Boolean);
      if (!parts.length) return;
      let cur = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const k = parts[i];
        if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k];
      }
      cur[parts[parts.length - 1]] = v;
    }

    // ── Org helpers ───────────────────────────────────────────────────────
    _org_normalize_dict(raw) {
      if (!raw) return {};
      if (Array.isArray(raw)) {
        const out = {};
        raw.forEach(item => { if (item && item.id) out[item.id] = item; });
        return out;
      }
      return raw;
    }

    _org_ensure_draft() {
      const s = this.p._org_state;
      if (s.meta_draft) return;
      const m = s.meta_store?.meta || null;
      if (m) {
        try { s.meta_draft = JSON.parse(JSON.stringify(m)); }
        catch (_) { s.meta_draft = m; }
      } else {
        s.meta_draft = { rooms: {}, types: {}, assignments: {} };
      }
      s.meta_draft.rooms = this._org_normalize_dict(s.meta_draft.rooms);
      s.meta_draft.types = this._org_normalize_dict(s.meta_draft.types);
      if (!s.meta_draft.assignments) s.meta_draft.assignments = {};
    }

    _org_reset_draft_from_store() {
      if (window.hse_store?.get('org.saving')) return;
      const s = this.p._org_state;
      const m = s.meta_store?.meta || null;
      if (!m) {
        s.meta_draft = { rooms: {}, types: {}, assignments: {} };
      } else {
        try { s.meta_draft = JSON.parse(JSON.stringify(m)); }
        catch (_) { s.meta_draft = m; }
      }
      s.meta_draft.rooms = this._org_normalize_dict(s.meta_draft.rooms);
      s.meta_draft.types = this._org_normalize_dict(s.meta_draft.types);
      if (!s.meta_draft.assignments) s.meta_draft.assignments = {};
      s.dirty = false;
    }

    async org_fetch_meta() {
      const p = this.p;
      if (!p._hass) return;
      if (p._org_state.loading) return;
      p._org_state.loading = true;
      p._org_state.error = null;
      p._org_state.message = null;
      p.requestUpdate();
      try {
        const resp = await p._hass.callApi('get', 'hse/unified/meta');
        p._org_state.meta_store = resp?.meta_store || null;
        p._org_state.error = null;
        if (!p._org_state.dirty) this._org_reset_draft_from_store();
        else this._org_ensure_draft();
      } catch (err) {
        p._org_state.error = this._err_msg(err);
      } finally {
        p._org_state.loading = false;
        if (p._active_tab === 'custom') p.requestUpdate();
      }
    }

    async org_save_meta() {
      const p = this.p;
      if (!p._hass) return;
      const s = p._org_state;
      if (s.saving || s.loading || s.preview_running || s.apply_running) return;
      this._org_ensure_draft();
      let draft_snapshot;
      try { draft_snapshot = JSON.parse(JSON.stringify(s.meta_draft)); }
      catch (_) { draft_snapshot = s.meta_draft; }
      if (window.hse_store) { window.hse_store.freeze('org.meta_draft'); window.hse_store.set('org.saving', true); }
      s.error = null;
      s.message = 'Sauvegarde en préparation…';
      const ok = window.confirm("Sauvegarder l'organisation (meta: rooms/types/assignments) ?");
      if (!ok) {
        if (window.hse_store) { window.hse_store.unfreeze('org.meta_draft'); window.hse_store.set('org.saving', false); }
        s.message = null;
        if (p._active_tab === 'custom') p.requestUpdate();
        return;
      }
      s.message = 'Sauvegarde…';
      try {
        const resp = await p._hass.callApi('post', 'hse/unified/meta', { meta: draft_snapshot });
        s.meta_store = resp?.meta_store || s.meta_store;
        s.message = 'Organisation sauvegardée.';
        s.error = null;
        s.dirty = false;
        if (window.hse_store) window.hse_store.unfreeze('org.meta_draft');
        this._org_reset_draft_from_store();
      } catch (err) {
        if (window.hse_store) window.hse_store.unfreeze('org.meta_draft');
        s.error = this._err_msg(err);
        s.message = 'Échec de sauvegarde.';
      } finally {
        if (window.hse_store) window.hse_store.set('org.saving', false);
        if (p._active_tab === 'custom') p.requestUpdate();
      }
    }

    async org_preview() {
      const p = this.p;
      if (!p._hass) return;
      const s = p._org_state;
      if (s.preview_running || s.loading) return;
      s.preview_running = true; s.error = null; s.message = null;
      p.requestUpdate();
      try {
        const resp = await p._hass.callApi('post', 'hse/unified/meta/sync/preview', { persist: true });
        s.meta_store = resp?.meta_store || s.meta_store;
        s.error = null; s.message = 'Propositions mises à jour.';
        if (!s.dirty) this._org_reset_draft_from_store();
        else this._org_ensure_draft();
      } catch (err) {
        s.error = this._err_msg(err);
      } finally {
        s.preview_running = false;
        if (p._active_tab === 'custom') p.requestUpdate();
      }
    }

    async org_apply(apply_mode) {
      const p = this.p;
      if (!p._hass) return;
      const s = p._org_state;
      if (s.apply_running || s.loading || s.preview_running) return;
      const mode = apply_mode === 'all' ? 'all' : 'auto';
      const msg = mode === 'all'
        ? 'Appliquer les changements proposés (mode ALL) ?\nCe mode peut écraser des choix manuels.'
        : 'Appliquer les changements proposés (mode auto) ?\nAucun champ manuel ne sera écrasé.';
      if (window.hse_store) { window.hse_store.freeze('org.meta_draft'); window.hse_store.set('org.saving', true); }
      const ok = window.confirm(msg);
      if (!ok) {
        if (window.hse_store) { window.hse_store.unfreeze('org.meta_draft'); window.hse_store.set('org.saving', false); }
        return;
      }
      s.apply_running = true; s.error = null; s.message = null;
      p.requestUpdate();
      try {
        const resp = await p._hass.callApi('post', 'hse/unified/meta/sync/apply', { apply_mode: mode });
        s.meta_store = resp?.meta_store || s.meta_store;
        s.error = null; s.message = 'Changements appliqués.';
        if (window.hse_store) window.hse_store.unfreeze('org.meta_draft');
        if (!s.dirty) this._org_reset_draft_from_store();
        else this._org_ensure_draft();
      } catch (err) {
        if (window.hse_store) window.hse_store.unfreeze('org.meta_draft');
        s.error = this._err_msg(err);
      } finally {
        if (window.hse_store) window.hse_store.set('org.saving', false);
        s.apply_running = false;
        if (p._active_tab === 'custom') p.requestUpdate();
      }
    }

    // ── Reference status ──────────────────────────────────────────────────
    _reference_effective_entity_id() {
      return this._cg('selected_reference_entity_id') || this._cg('current_reference_entity_id') || null;
    }

    async fetch_reference_status(for_entity_id) {
      const p = this.p;
      if (!p._hass || !window.hse_config_api?.get_reference_total_status) return null;
      const requested = for_entity_id === undefined ? this._reference_effective_entity_id() : for_entity_id;
      p._reference_status_target_entity_id = requested;
      if (p._reference_status_polling) return this._cg('reference_status');
      p._reference_status_polling = true;
      try {
        while (true) {
          const entity_id = p._reference_status_target_entity_id;
          const resp = await window.hse_config_api.get_reference_total_status(p._hass, entity_id);
          if (p._reference_status_target_entity_id !== entity_id) continue;
          const effective = this._reference_effective_entity_id();
          if (effective !== entity_id) { p._reference_status_target_entity_id = effective; continue; }
          this._cs('reference_status', resp || null);
          this._cs('reference_status_error', null);
          return resp || null;
        }
      } catch (err) {
        this._cs('reference_status_error', this._err_msg(err));
        return null;
      } finally {
        p._reference_status_polling = false;
        if (p._active_tab === 'config') p.requestUpdate();
      }
    }
  }

  window.hse_panel_actions = HsePanelActions;
})();
