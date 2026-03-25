#!/usr/bin/env python3
"""
fix_hse_store_reinit.py
-----------------------
Corrige le bug "page vide au retour bureau virtuel" dans HSE.

Problème : au retour, HA recrée le custom element hse-panel.
_boot() est rappelé mais load_script_once ne recharge pas les scripts
(déjà dans le DOM). hse_store est une nouvelle instance mais
overview.state / diag.state / config.state ont leurs subscribers
branchés sur l'ANCIEN store → tout est désynchronisé → page vide.

Solution : exposer une fonction _init() dans chaque state module,
et dans _boot() détecter si hse_store a changé pour rappeler ces inits.

Fichiers modifiés :
  1. overview.state.js  — extrait _init(), l'expose dans window
  2. diag.state.js      — extrait _init(), l'expose dans window
  3. config.state.js    — extrait _init(), l'expose dans window
  4. hse_panel.js       — _boot() : détection store changé + appel inits
                        — customElements.define : guard contre double define
                        — boot_and_define : guard contre double boot

Usage :
  cd /chemin/vers/repo/hse   # racine du repo (où est custom_components/)
  python3 fix_hse_store_reinit.py
  # puis bumper ASSET_V dans hse_panel.js et const.py
  # puis git add -A && git commit -m "fix: store reinit au retour bureau virtuel"
"""

import re
import sys
import os

BASE = os.path.dirname(os.path.abspath(__file__))

def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  ✓ {path}")

# ─────────────────────────────────────────────────────────────────────────────
# 1. overview.state.js
# ─────────────────────────────────────────────────────────────────────────────
def fix_overview_state(path):
    content = read(path)

    old_bootstrap = """  // ── Init ──────────────────────────────────────────────────────────────────
  _restore_from_storage();
  _subscribe_persistence();
  _subscribe_patch_live();

  window.hse_overview_state = {
    get_state,
    begin_fetch,
    end_fetch,
    register_container,
    update_hass,
    get: _get,
    set: _set,
  };"""

    new_bootstrap = """  // ── Init ──────────────────────────────────────────────────────────────────
  function _init() {
    _restore_from_storage();
    _subscribe_persistence();
    _subscribe_patch_live();
  }

  _init(); // premier boot

  // Exposé pour que hse_panel._boot() puisse rappeler _init()
  // quand hse_store a été recréé (retour bureau virtuel).
  window.hse_overview_state_init = _init;

  window.hse_overview_state = {
    get_state,
    begin_fetch,
    end_fetch,
    register_container,
    update_hass,
    get: _get,
    set: _set,
  };"""

    if 'hse_overview_state_init' in content:
        print(f"  ⚠ overview.state.js déjà patché, skip")
        return
    if old_bootstrap not in content:
        print(f"  ⚠ overview.state.js : bloc bootstrap introuvable, patch manuel requis")
        return
    write(path, content.replace(old_bootstrap, new_bootstrap))

# ─────────────────────────────────────────────────────────────────────────────
# 2. diag.state.js
# ─────────────────────────────────────────────────────────────────────────────
def fix_diag_state(path):
    content = read(path)

    old_bootstrap = """  // ── Bootstrap ────────────────────────────────────────────────────────────────
  const store = _s();

  if (store) {
    _restore_from_storage();
    _subscribe_persistence();
    window.hse_diag_state = _make_api();
    console.debug('[HSE] diag.state.js loaded — window.hse_diag_state ready (Phase 8)');
  } else {"""

    new_bootstrap = """  // ── Bootstrap ────────────────────────────────────────────────────────────────
  function _init() {
    const s = _s();
    if (s) {
      _restore_from_storage();
      _subscribe_persistence();
      window.hse_diag_state = _make_api();
    }
  }

  // Exposé pour réinit au retour bureau virtuel (hse_store recréé)
  window.hse_diag_state_init = _init;

  const store = _s();

  if (store) {
    _restore_from_storage();
    _subscribe_persistence();
    window.hse_diag_state = _make_api();
    console.debug('[HSE] diag.state.js loaded — window.hse_diag_state ready (Phase 8)');
  } else {"""

    if 'hse_diag_state_init' in content:
        print(f"  ⚠ diag.state.js déjà patché, skip")
        return
    if old_bootstrap not in content:
        print(f"  ⚠ diag.state.js : bloc bootstrap introuvable, patch manuel requis")
        return
    write(path, content.replace(old_bootstrap, new_bootstrap))

# ─────────────────────────────────────────────────────────────────────────────
# 3. config.state.js
# ─────────────────────────────────────────────────────────────────────────────
def fix_config_state(path):
    content = read(path)

    old_bootstrap = """  // ── Bootstrap ────────────────────────────────────────────────────────────────
  const store = _s();

  if (store) {
    _restore_from_storage();
    _subscribe_persistence();
    window.hse_config_state = _make_api();
    console.debug('[HSE] config.state.js loaded — window.hse_config_state ready (Phase 8)');
  } else {"""

    new_bootstrap = """  // ── Bootstrap ────────────────────────────────────────────────────────────────
  function _init() {
    const s = _s();
    if (s) {
      _restore_from_storage();
      _subscribe_persistence();
      window.hse_config_state = _make_api();
    }
  }

  // Exposé pour réinit au retour bureau virtuel (hse_store recréé)
  window.hse_config_state_init = _init;

  const store = _s();

  if (store) {
    _restore_from_storage();
    _subscribe_persistence();
    window.hse_config_state = _make_api();
    console.debug('[HSE] config.state.js loaded — window.hse_config_state ready (Phase 8)');
  } else {"""

    if 'hse_config_state_init' in content:
        print(f"  ⚠ config.state.js déjà patché, skip")
        return
    if old_bootstrap not in content:
        print(f"  ⚠ config.state.js : bloc bootstrap introuvable, patch manuel requis")
        return
    write(path, content.replace(old_bootstrap, new_bootstrap))

# ─────────────────────────────────────────────────────────────────────────────
# 4. hse_panel.js — _boot() + guards
# ─────────────────────────────────────────────────────────────────────────────
def fix_hse_panel(path):
    content = read(path)
    changed = False

    # ── 4a. Guard customElements.define ──────────────────────────────────────
    old_define = "    customElements.define('hse-panel', HsePanel);\n    console.info(`[HSE] hse-panel (Lit) registered (${build_signature})`);"
    new_define = """    if (!customElements.get('hse-panel')) {
      customElements.define('hse-panel', HsePanel);
      console.info(`[HSE] hse-panel (Lit) registered (${build_signature})`);
    } else {
      console.info(`[HSE] hse-panel already defined, skipping (${build_signature})`);
    }"""

    if old_define in content:
        content = content.replace(old_define, new_define)
        changed = True
    elif 'hse-panel already defined' not in content:
        print("  ⚠ hse_panel.js : guard customElements.define introuvable, patch manuel requis")

    # ── 4b. Guard boot_and_define ─────────────────────────────────────────────
    old_boot_call = "  boot_and_define().catch(err => console.error('[HSE] boot_and_define failed', err));"
    new_boot_call = """  if (!window.__hse_boot_started) {
    window.__hse_boot_started = true;
    boot_and_define().catch(err => console.error('[HSE] boot_and_define failed', err));
  }"""

    if old_boot_call in content:
        content = content.replace(old_boot_call, new_boot_call)
        changed = True
    elif '__hse_boot_started' not in content:
        print("  ⚠ hse_panel.js : guard boot_and_define introuvable, patch manuel requis")

    # ── 4c. Injection détection store changé dans _boot() ────────────────────
    old_actions_comment = "          // Instancie actions après chargement\n          this._actions = new window.hse_panel_actions(this);"
    new_actions_comment = """          // ── Réinit modules si hse_store a été recréé ──────────────────
          // Au retour bureau virtuel, HA recrée hse-panel sans recharger
          // les scripts. Si hse_store est une nouvelle instance, on
          // rebranche overview/diag/config state sur ce nouveau store.
          const _store_id = window.hse_store?._instance_id;
          if (!_store_id || _store_id !== window.__hse_last_store_id) {
            if (window.hse_store) {
              window.hse_store._instance_id = Date.now();
              window.__hse_last_store_id = window.hse_store._instance_id;
            }
            if (typeof window.hse_overview_state_init === 'function') window.hse_overview_state_init();
            if (typeof window.hse_diag_state_init     === 'function') window.hse_diag_state_init();
            if (typeof window.hse_config_state_init   === 'function') window.hse_config_state_init();
            console.info('[HSE] store reinit: modules rebranches sur nouveau hse_store');
          }

          // Instancie actions après chargement
          this._actions = new window.hse_panel_actions(this);"""

    if old_actions_comment in content:
        content = content.replace(old_actions_comment, new_actions_comment)
        changed = True
    elif '__hse_last_store_id' not in content:
        print("  ⚠ hse_panel.js : bloc 'Instancie actions' introuvable, patch manuel requis")

    if changed:
        write(path, content)
    else:
        print("  ⚠ hse_panel.js : aucun changement appliqué")

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main():
    panel_base = os.path.join(BASE, "custom_components", "hse", "web_static", "panel")

    files = {
        "overview.state.js": os.path.join(panel_base, "features", "overview", "overview.state.js"),
        "diag.state.js":     os.path.join(panel_base, "features", "diagnostic", "diag.state.js"),
        "config.state.js":   os.path.join(panel_base, "features", "config", "config.state.js"),
        "hse_panel.js":      os.path.join(panel_base, "hse_panel.js"),
    }

    missing = [k for k, v in files.items() if not os.path.exists(v)]
    if missing:
        print(f"ERREUR : fichiers introuvables : {missing}")
        print(f"Lance ce script depuis la RACINE du repo hse (où se trouve custom_components/)")
        sys.exit(1)

    print("\n=== fix_hse_store_reinit.py ===\n")
    fix_overview_state(files["overview.state.js"])
    fix_diag_state(files["diag.state.js"])
    fix_config_state(files["config.state.js"])
    fix_hse_panel(files["hse_panel.js"])
    print("\nDone. Pense a bumper ASSET_V dans hse_panel.js et const.py avant de commit.")

if __name__ == "__main__":
    main()
