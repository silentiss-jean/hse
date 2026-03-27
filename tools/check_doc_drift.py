#!/usr/bin/env python3
"""
check_doc_drift.py — Détecte les fichiers source modifiés après leur documentation.

Couverture :
  - Tous les fichiers .py du backend (custom_components/hse/)
  - Tous les fichiers .js / .css / .html du frontend (web_static/)

Usage:
    python tools/check_doc_drift.py
    python tools/check_doc_drift.py --verbose
    python tools/check_doc_drift.py --ci   (exit 1 si drifts détectés)
"""

import subprocess
import sys
import argparse
from pathlib import Path
from datetime import datetime

# ---------------------------------------------------------------------------
# MAPPING BACKEND (.py) -> doc(s) associée(s)
# None = doc inexistante (à créer)
# ---------------------------------------------------------------------------
BACKEND_MAPPING = {
    # Bootstrap / Intégration HA
    "custom_components/hse/__init__.py": ["custom_components/hse/docs/init_py.md"],
    "custom_components/hse/config_flow.py": ["custom_components/hse/docs/config_flow.md"],
    "custom_components/hse/const.py": ["custom_components/hse/docs/const.md"],
    "custom_components/hse/manifest.json": ["custom_components/hse/docs/manifest.md"],
    "custom_components/hse/repairs.py": None,
    "custom_components/hse/time_utils.py": None,

    # Catalogue
    "custom_components/hse/catalogue_defaults.py": ["custom_components/hse/docs/persistent_catalogue.md"],
    "custom_components/hse/catalogue_manager.py": ["custom_components/hse/docs/persistent_catalogue.md"],
    "custom_components/hse/catalogue_schema.py": ["custom_components/hse/docs/persistent_catalogue.md"],
    "custom_components/hse/catalogue_store.py": ["custom_components/hse/docs/persistent_catalogue.md"],

    # Méta
    "custom_components/hse/meta_schema.py": ["custom_components/hse/docs/unified_api.md"],
    "custom_components/hse/meta_store.py": ["custom_components/hse/docs/unified_api.md"],
    "custom_components/hse/meta_sync.py": ["custom_components/hse/docs/unified_api.md"],

    # Moteurs
    "custom_components/hse/shared_cost_engine.py": None,
    "custom_components/hse/scan_engine.py": ["custom_components/hse/docs/entities_scan.md"],

    # API
    "custom_components/hse/api/unified_api.py": [
        "custom_components/hse/docs/unified_api.md",
        "custom_components/hse/docs/overview_api.md",
    ],
    "custom_components/hse/api/views/catalogue_get.py": ["custom_components/hse/docs/overview_api.md"],
    "custom_components/hse/api/views/catalogue_refresh.py": ["custom_components/hse/docs/overview_api.md"],
    "custom_components/hse/api/views/catalogue_item_triage.py": ["custom_components/hse/docs/overview_api.md"],
    "custom_components/hse/api/views/catalogue_triage_bulk.py": ["custom_components/hse/docs/overview_api.md"],
    "custom_components/hse/api/views/catalogue_reference_total.py": None,
    "custom_components/hse/api/views/costs_compare.py": None,
    "custom_components/hse/api/views/dashboard_overview.py": ["custom_components/hse/docs/overview_view.md"],
    "custom_components/hse/api/views/diagnostic_check.py": None,
    "custom_components/hse/api/views/enrich_apply.py": None,
    "custom_components/hse/api/views/enrich_cleanup.py": None,
    "custom_components/hse/api/views/enrich_diagnose.py": None,
    "custom_components/hse/api/views/enrich_preview.py": None,
    "custom_components/hse/api/views/entities_scan.py": [
        "custom_components/hse/docs/entities_scan.md",
        "custom_components/hse/docs/scan_api.md",
    ],
    "custom_components/hse/api/views/frontend_manifest.py": None,
    "custom_components/hse/api/views/meta.py": ["custom_components/hse/docs/unified_api.md"],
    "custom_components/hse/api/views/meta_sync_apply.py": ["custom_components/hse/docs/unified_api.md"],
    "custom_components/hse/api/views/meta_sync_preview.py": ["custom_components/hse/docs/unified_api.md"],
    "custom_components/hse/api/views/migration_export.py": None,
    "custom_components/hse/api/views/settings_pricing.py": ["custom_components/hse/docs/pricing_settings.md"],
    "custom_components/hse/api/views/ping.py": None,
}

# ---------------------------------------------------------------------------
# MAPPING FRONTEND (.js / .css / .html) -> doc associée
# Règle : cherche un .md dans docs/ dont le nom correspond au dossier feature
# Par exemple : features/scan/*.js -> docs/scan_ui.md
# ---------------------------------------------------------------------------
FRONTEND_DOC_HINTS = {
    "panel/core/loader.js":        ["custom_components/hse/docs/panel_loader.md"],
    "panel/core/shell.js":         ["custom_components/hse/docs/panel_shell.md"],
    "panel/core/panel.actions.js": ["custom_components/hse/docs/hse_panel.md"],
    "panel/hse_panel.js":          ["custom_components/hse/docs/hse_panel.md"],
    "panel/hse_panel.html":        ["custom_components/hse/docs/hse_panel.md"],
    "panel/style.hse.panel.css":   ["custom_components/hse/docs/panel_style.md"],
    "panel/features/scan":         ["custom_components/hse/docs/scan_ui.md"],
    "panel/features/overview":     ["custom_components/hse/docs/overview_view.md"],
    "panel/features/config":       ["custom_components/hse/docs/config_ui.md"],
    "panel/features/costs":        ["custom_components/hse/docs/overview_view.md"],
    "panel/features/diagnostic":   None,
    "panel/features/enrich":       None,
    "panel/features/migration":    None,
    "panel/features/cards":        None,
    "panel/features/custom":       ["custom_components/hse/docs/custom_view.md"],
    "panel/features/placeholder":  ["custom_components/hse/docs/placeholder_view.md"],
}

FRONTEND_ROOT = Path("custom_components/hse/web_static")
FRONTEND_EXTENSIONS = {".js", ".css", ".html"}
FRONTEND_EXCLUDE = {".DS_Store"}

GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"


def last_commit_timestamp(path: str) -> int:
    result = subprocess.run(
        ["git", "log", "-1", "--format=%ct", "--", path],
        capture_output=True, text=True
    )
    ts = result.stdout.strip()
    return int(ts) if ts else 0


def find_frontend_doc(rel_path: str):
    """
    Pour un chemin relatif à web_static (ex: panel/features/scan/scan.js),
    retourne la doc associée selon FRONTEND_DOC_HINTS, ou None si absente.
    """
    # Cherche la correspondance la plus précise (chemin le plus long en premier)
    for hint_key in sorted(FRONTEND_DOC_HINTS.keys(), key=len, reverse=True):
        if rel_path.startswith(hint_key):
            return FRONTEND_DOC_HINTS[hint_key]
    return None  # Pas de mapping défini = pas de doc attendue


def collect_frontend_files():
    """Retourne tous les .js/.css/.html sous web_static/ (hors .DS_Store)."""
    if not FRONTEND_ROOT.exists():
        return []
    files = []
    for p in sorted(FRONTEND_ROOT.rglob("*")):
        if p.is_file() and p.suffix in FRONTEND_EXTENSIONS and p.name not in FRONTEND_EXCLUDE:
            files.append(p)
    return files


def run_section(title: str, items: dict, verbose: bool):
    drift_count = 0
    no_doc_count = 0
    ok_count = 0

    print(f"{BOLD}--- {title} ---{RESET}")

    for src, docs in items.items():
        src_ts = last_commit_timestamp(src)

        if not Path(src).exists() and src_ts == 0:
            if verbose:
                print(f"{DIM}➖  ABSENT LOCAL{RESET}: {src}")
            continue

        if docs is None:
            no_doc_count += 1
            print(f"{RED}❌ PAS DE DOC{RESET}: {src}")
            continue

        doc_ts = max(last_commit_timestamp(d) for d in docs)

        if src_ts > doc_ts:
            drift_count += 1
            src_date = datetime.fromtimestamp(src_ts).strftime("%Y-%m-%d")
            doc_date = datetime.fromtimestamp(doc_ts).strftime("%Y-%m-%d") if doc_ts else "jamais"
            print(f"{YELLOW}⚠  DOC PÉRIMÉE{RESET}: {src}")
            print(f"   src modifié: {src_date} | doc modifiée: {doc_date}")
            print(f"   → Mettre à jour: {', '.join(docs)}")
        else:
            ok_count += 1
            if verbose:
                print(f"{GREEN}✅ OK{RESET}: {src}")

    print()
    return drift_count, no_doc_count, ok_count


def run_check(verbose: bool = False) -> int:
    total_drift = total_no_doc = total_ok = 0

    print(f"\n{BOLD}=== HSE Doc Drift Checker ==={RESET}\n")

    # --- Section Backend ---
    d, n, o = run_section("BACKEND — Python", BACKEND_MAPPING, verbose)
    total_drift += d
    total_no_doc += n
    total_ok += o

    # --- Section Frontend ---
    frontend_files = collect_frontend_files()
    frontend_mapping = {}
    for p in frontend_files:
        rel = str(p.relative_to(FRONTEND_ROOT))
        docs = find_frontend_doc(rel)
        frontend_mapping[str(p)] = docs

    d, n, o = run_section("FRONTEND — JS / CSS / HTML", frontend_mapping, verbose)
    total_drift += d
    total_no_doc += n
    total_ok += o

    # --- Résumé global ---
    print(f"{BOLD}=== Résumé global ==={RESET}")
    print(f"  {GREEN}✅ À jour  : {total_ok}{RESET}")
    print(f"  {YELLOW}⚠  Périmé  : {total_drift}{RESET}")
    print(f"  {RED}❌ Sans doc : {total_no_doc}{RESET}")
    print()

    return 1 if (total_drift > 0 or total_no_doc > 0) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Détecte les docs périmées dans HSE.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Affiche aussi les fichiers OK")
    parser.add_argument("--ci", action="store_true", help="Mode CI : exit 1 si drifts détectés")
    args = parser.parse_args()

    exit_code = run_check(verbose=args.verbose)

    if args.ci and exit_code != 0:
        sys.exit(exit_code)
