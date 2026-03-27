#!/usr/bin/env python3
"""
check_doc_drift.py — Détecte les fichiers source modifiés après leur documentation.

Usage:
    python tools/check_doc_drift.py
    python tools/check_doc_drift.py --verbose

Retourne un code 1 si des drifts sont détectés (utile en CI).
"""

import subprocess
import sys
import argparse
from pathlib import Path

# Mapping source -> doc(s) associée(s)
# None = doc inexistante (à créer)
MAPPING = {
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

GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def last_commit_timestamp(path: str) -> int:
    """Retourne le timestamp unix du dernier commit touchant ce fichier."""
    result = subprocess.run(
        ["git", "log", "-1", "--format=%ct", "--", path],
        capture_output=True, text=True
    )
    ts = result.stdout.strip()
    return int(ts) if ts else 0


def run_check(verbose: bool = False) -> int:
    drift_count = 0
    no_doc_count = 0
    ok_count = 0

    print(f"\n{BOLD}=== HSE Doc Drift Checker ==={RESET}\n")

    for src, docs in MAPPING.items():
        src_ts = last_commit_timestamp(src)

        if not Path(src).exists() and src_ts == 0:
            if verbose:
                print(f"{YELLOW}⚠  ABSENT DU REPO LOCAL{RESET}: {src}")
            continue

        if docs is None:
            no_doc_count += 1
            print(f"{RED}❌ PAS DE DOC{RESET}: {src}")
            continue

        # Prend le timestamp le plus récent parmi les docs liées
        doc_ts = max(last_commit_timestamp(d) for d in docs)

        if src_ts > doc_ts:
            drift_count += 1
            from datetime import datetime
            src_date = datetime.fromtimestamp(src_ts).strftime("%Y-%m-%d")
            doc_date = datetime.fromtimestamp(doc_ts).strftime("%Y-%m-%d") if doc_ts else "jamais"
            print(f"{YELLOW}⚠  DOC PÉRIMÉE{RESET}: {src}")
            print(f"   src modifié: {src_date} | doc modifiée: {doc_date}")
            print(f"   → Mettre à jour: {', '.join(docs)}")
        else:
            ok_count += 1
            if verbose:
                print(f"{GREEN}✅ OK{RESET}: {src}")

    print(f"\n{BOLD}--- Résumé ---{RESET}")
    print(f"  {GREEN}✅ À jour  : {ok_count}{RESET}")
    print(f"  {YELLOW}⚠  Périmé  : {drift_count}{RESET}")
    print(f"  {RED}❌ Sans doc : {no_doc_count}{RESET}")
    print()

    if drift_count > 0 or no_doc_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Détecte les docs périmées dans HSE.")
    parser.add_argument("--verbose", "-v", action="store_true", help="Affiche aussi les fichiers OK")
    parser.add_argument("--ci", action="store_true", help="Mode CI : exit 1 si drifts détectés")
    args = parser.parse_args()

    exit_code = run_check(verbose=args.verbose)

    if args.ci and exit_code != 0:
        sys.exit(exit_code)
