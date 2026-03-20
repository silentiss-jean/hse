#!/usr/bin/env python3
"""Fix hse_panel.js : suppression doublon, fix syntaxe, bump signature."""

import re

FILE = "custom_components/HSE/web_static/panel/hse_panel.js"

with open(FILE, "r", encoding="utf-8") as f:
    content = f.read()

# ── 1. Supprimer la duplication ──────────────────────────────────────────────
marker = "})();"
first_end = content.find(marker)
if first_end != -1:
    content = content[: first_end + len(marker)] + "\n"
    print("✅ Duplication supprimée")
else:
    print("⚠️  Marqueur })(); non trouvé — duplication non corrigée")

# ── 2. Fix bug reference_status ──────────────────────────────────────────────
old = "this._cg('reference_statu')s = {"
new = "this._cs('reference_status', {"

# Aussi fermer avec ); au lieu de ;
old_close = """            entity_id: snapshot.entity_id || cur || this._cg('selected_reference_entity_id') || null,
          };"""
new_close = """            entity_id: snapshot.entity_id || cur || this._cg('selected_reference_entity_id') || null,
          });"""

if old in content:
    content = content.replace(old, new)
    content = content.replace(old_close, new_close)
    print("✅ Bug reference_status corrigé")
else:
    print("⚠️  Pattern reference_status non trouvé — vérifier manuellement")

# ── 3. Fix bug scan_result ───────────────────────────────────────────────────
old2 = "this._cg('scan_resul')t = await window.hse_scan_api.fetch_scan(this._hass, {"
new2 = "this._cs('scan_result', await window.hse_scan_api.fetch_scan(this._hass, {"

old2_close = """            exclude_hse: true,
          });"""
new2_close = """            exclude_hse: true,
          }));"""

if old2 in content:
    content = content.replace(old2, new2)
    content = content.replace(old2_close, new2_close)
    print("✅ Bug scan_result corrigé")
else:
    print("⚠️  Pattern scan_result non trouvé — vérifier manuellement")

# ── 4. Bump build_signature ──────────────────────────────────────────────────
old3 = 'const build_signature = "2026-03-20_refonte_store_phase8";'
new3 = 'const build_signature = "2026-03-20_refonte_store_phase9";'
if old3 in content:
    content = content.replace(old3, new3)
    print("✅ build_signature → phase9")
else:
    print("⚠️  build_signature non mis à jour")

# ── 5. Écriture ──────────────────────────────────────────────────────────────
with open(FILE, "w", encoding="utf-8") as f:
    f.write(content)

print("\n✅ Fichier écrit.")

# ── 6. Vérifications finales ─────────────────────────────────────────────────
with open(FILE, "r", encoding="utf-8") as f:
    result = f.read()

bug1 = "reference_statu')s"
bug2 = "scan_resul')t"

print("\n── Vérifications ──")
print("customElements.define   :", result.count("customElements.define"), " (attendu: 1)")
print("bug reference_status    :", result.count(bug1), " (attendu: 0)")
print("bug scan_result         :", result.count(bug2), " (attendu: 0)")
print("phase9                  :", result.count("phase9"), " (attendu: 1)")

