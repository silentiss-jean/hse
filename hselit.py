#!/usr/bin/env python3
"""
phase10_download_lit.py
Télécharge Lit 3 core et le place dans web_static/shared/lib/
Lance depuis la racine du repo : python3 scripts/phase10_download_lit.py
"""
import urllib.request, pathlib, sys

LIT_URL = "https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js"
OUT     = pathlib.Path("custom_components/hse/web_static/shared/lib/lit-core.min.js")

OUT.parent.mkdir(parents=True, exist_ok=True)

print(f"[phase10] Téléchargement Lit 3 core…")
try:
    with urllib.request.urlopen(LIT_URL) as r:
        raw = r.read().decode("utf-8")
except Exception as e:
    sys.exit(f"[ERREUR] Téléchargement échoué : {e}")

print(f"[phase10] {len(raw)} chars reçus")
OUT.write_text(raw, encoding="utf-8")
print(f"[phase10] ✅ Écrit : {OUT}")
print()
print("Prochaine étape : dans hse_panel.js remplacer le chargement Lit par :")
print("  await _load_lit(`${SHARED_BASE}/lib/lit-core.min.js?v=${ASSET_V}`);")

