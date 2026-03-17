/**
 * org.state.js — Helpers d'état pour l'onglet Organisation (custom)
 *
 * Ce module gère le cycle de vie du meta_draft en s'appuyant
 * sur window.hse_store. Il isole la logique d'état de la logique
 * de rendu dans custom.view.js.
 *
 * Expose : window.hse_org_state
 */

(function () {
  const _store = () => window.hse_store;

  // ── Clés store utilisées par l'onglet org ─────────────────────────────────
  const KEY_META_STORE  = 'org.meta_store';
  const KEY_META_DRAFT  = 'org.meta_draft';
  const KEY_DIRTY       = 'org.dirty';
  const KEY_SAVING      = 'org.saving';   // true pendant un save async (protège le draft)
  const KEY_LOADING     = 'org.loading';
  const KEY_ERROR       = 'org.error';
  const KEY_MESSAGE     = 'org.message';

  // ── Normalisation ─────────────────────────────────────────────────────────

  function _normalize_dict(raw) {
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const out = {};
      raw.forEach(item => { if (item && item.id) out[item.id] = item; });
      return out;
    }
    return raw;
  }

  function _normalize_draft(draft) {
    if (!draft) return { rooms: {}, types: {}, assignments: {} };
    draft.rooms       = _normalize_dict(draft.rooms);
    draft.types       = _normalize_dict(draft.types);
    draft.assignments = draft.assignments || {};
    return draft;
  }

  // ── Lecture du draft courant ──────────────────────────────────────────────

  function get_draft() {
    return _store().get(KEY_META_DRAFT);
  }

  function get_meta_store() {
    return _store().get(KEY_META_STORE);
  }

  function is_dirty() {
    return !!_store().get(KEY_DIRTY);
  }

  function is_saving() {
    return !!_store().get(KEY_SAVING);
  }

  function is_loading() {
    return !!_store().get(KEY_LOADING);
  }

  function get_error() {
    return _store().get(KEY_ERROR) || null;
  }

  function get_message() {
    return _store().get(KEY_MESSAGE) || null;
  }

  // ── Initialisation du draft depuis le store serveur ───────────────────────

  function ensure_draft() {
    if (_store().get(KEY_META_DRAFT)) return;
    reset_draft_from_store();
  }

  function reset_draft_from_store() {
    const m = _store().get(KEY_META_STORE)?.meta || null;
    let draft;
    if (!m) {
      draft = { rooms: {}, types: {}, assignments: {} };
    } else {
      try { draft = JSON.parse(JSON.stringify(m)); }
      catch (_) { draft = m; }
    }
    _normalize_draft(draft);
    _store().set(KEY_META_DRAFT, draft);
    _store().set(KEY_DIRTY, false);
  }

  // ── Patch d'un champ du draft ─────────────────────────────────────────────

  function patch_draft(path_parts, path_str, value) {
    ensure_draft();
    const draft = _store().get(KEY_META_DRAFT);
    if (!draft) return;

    if (Array.isArray(path_parts) && path_parts.length) {
      let cur = draft;
      for (let i = 0; i < path_parts.length - 1; i++) {
        if (!cur[path_parts[i]] || typeof cur[path_parts[i]] !== 'object') cur[path_parts[i]] = {};
        cur = cur[path_parts[i]];
      }
      cur[path_parts[path_parts.length - 1]] = value;
    } else if (path_str) {
      const parts = String(path_str).split('.').filter(Boolean);
      let cur = draft;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    }

    // On force la notification en remplaçant la référence
    _store().set(KEY_META_DRAFT, Object.assign({}, draft));
    _store().set(KEY_DIRTY, true);
  }

  // ── Snapshot sûr du draft (pour envoi API) ────────────────────────────────

  /**
   * Retourne une copie profonde du draft courant.
   * Cette copie est immunisée contre les modifications concurrentes.
   * À appeler AVANT window.confirm() dans les fonctions async de sauvegarde.
   */
  function snapshot_draft() {
    return _store().snapshot(KEY_META_DRAFT);
  }

  // ── Cycle saving (protège le draft pendant le POST) ───────────────────────

  /**
   * Démarre une opération de sauvegarde :
   *  1. Gèle la clé meta_draft dans le store (les set() polling seront ignorés)
   *  2. Marque saving = true
   * @returns {object} snapshot du draft au moment de l'appel
   */
  function begin_save() {
    _store().freeze(KEY_META_DRAFT);
    _store().set(KEY_SAVING, true);
    _store().set(KEY_ERROR, null);
    _store().set(KEY_MESSAGE, 'Sauvegarde…');
    return snapshot_draft();
  }

  /**
   * Termine une opération de sauvegarde.
   * @param {boolean} success
   * @param {object|null} new_meta_store — réponse serveur si succès
   * @param {string|null} error_msg
   */
  function end_save(success, new_meta_store, error_msg) {
    _store().unfreeze(KEY_META_DRAFT);
    _store().set(KEY_SAVING, false);

    if (success && new_meta_store != null) {
      _store().set(KEY_META_STORE, new_meta_store);
      _store().set(KEY_DIRTY, false);
      _store().set(KEY_ERROR, null);
      _store().set(KEY_MESSAGE, 'Organisation sauvegardée.');
      reset_draft_from_store();
    } else if (!success) {
      _store().set(KEY_ERROR, error_msg || 'Échec de sauvegarde.');
      _store().set(KEY_MESSAGE, 'Échec de sauvegarde.');
    }
  }

  // ── Exposition publique ───────────────────────────────────────────────────

  window.hse_org_state = {
    KEY_META_STORE,
    KEY_META_DRAFT,
    KEY_DIRTY,
    KEY_SAVING,
    KEY_LOADING,
    KEY_ERROR,
    KEY_MESSAGE,

    get_draft,
    get_meta_store,
    is_dirty,
    is_saving,
    is_loading,
    get_error,
    get_message,

    ensure_draft,
    reset_draft_from_store,
    patch_draft,
    snapshot_draft,
    begin_save,
    end_save,
  };

  console.debug('[HSE] org.state.js loaded — window.hse_org_state ready');
})();
