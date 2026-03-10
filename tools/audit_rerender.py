#!/usr/bin/env python3
"""
audit_rerender.py
-----------------
Audit des re-renders automatiques dans hse_panel.js.

Objectif:
  Identifier tous les appels this._render() / this._render_if_not_interacting()
  qui sont émis automatiquement (polling, timers, fetch) et non suite à une action
  utilisateur explicite, afin de planifier la migration vers un rendu partiel
  (AUDIT-RERENDER-001, AUDIT-RERENDER-002, ...).

Usage:
  python3 tools/audit_rerender.py
  python3 tools/audit_rerender.py --file path/to/hse_panel.js
  python3 tools/audit_rerender.py --json   # sortie JSON structurée

Sortie:
  - Liste des occurrences classées par catégorie:
      AUTO   : render automatique (polling / timer / finally sans action user)
      ACTION : render suite à une action utilisateur (attendu, OK)
      AUDIT  : ligne taggée AUDIT-RERENDER-xxx (déjà identifiée)
  - Score de risque par onglet affecté
  - TODO list pour migration vers rendu partiel
"""

import re
import sys
import json
import argparse
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_FILE = Path(__file__).parent.parent / "custom_components" / "HSE" / "web_static" / "panel" / "hse_panel.js"

# Patterns qui indiquent un contexte AUTO (non-utilisateur)
AUTO_CONTEXT_PATTERNS = [
    r"setInterval",
    r"setTimeout",
    r"finally\s*{",
    r"autorefresh",
    r"polling",
    r"_overview_timer",
    r"_reference_status_timer",
    r"tick\s*=\s*async",
    r"tick\(\)",
]

# Patterns qui indiquent une action utilisateur (render OK)
ACTION_CONTEXT_PATTERNS = [
    r'action\s*===\s*"',
    r"addEventListener\s*\(",
    r"btn\.addEventListener",
    r"confirm\(",
    r"_set_active_tab",
    r"_set_theme",
]

# Tags déjà identifiés dans le code
AUDIT_TAG_PATTERN = re.compile(r"AUDIT-RERENDER-(\d+)")

# Pattern de détection d'un appel render
RENDER_CALL_PATTERN = re.compile(
    r"this\._render(?:_if_not_interacting)?\s*\(\s*\)"
)

# Onglets affectés par contexte de méthode
TAB_MAP = {
    "_render_config": "config",
    "_render_overview": "overview",
    "_render_costs": "costs",
    "_render_diagnostic": "diagnostic",
    "_render_scan": "scan",
    "_render_migration": "migration",
    "_render_custom": "custom",
    "_fetch_reference_status": "config",
    "_ensure_overview_autorefresh": "overview+costs",
    "_ensure_reference_status_polling": "config",
    "_org_fetch_meta": "custom",
    "_org_save_meta": "custom",
    "_org_preview": "custom",
    "_org_apply": "custom",
}

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class RenderCall:
    line_no: int
    line: str
    method_ctx: str
    tab: str
    category: str          # AUTO | ACTION | AUDIT | UNKNOWN
    audit_tag: Optional[str]
    render_variant: str    # _render | _render_if_not_interacting
    risk: str              # HIGH | MEDIUM | LOW
    todo: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def detect_current_method(lines: List[str], current_idx: int) -> str:
    """Remonte jusqu'à la définition de méthode la plus proche."""
    for i in range(current_idx, -1, -1):
        m = re.search(r"(?:async\s+)?(\w+)\s*\(", lines[i])
        if m and not lines[i].strip().startswith("//") and not lines[i].strip().startswith("*"):
            name = m.group(1)
            # Filtre les faux positifs (if, for, while, function calls...)
            if name not in ("if", "for", "while", "switch", "catch", "try", "const", "let", "var", "return", "new", "await"):
                # Vérifie que c'est une déclaration de méthode (indentation faible)
                stripped = lines[i].lstrip()
                if stripped.startswith("async ") or re.match(r"^\w+\s*\(", stripped) or re.match(r"^\w+\s*=\s*async", stripped):
                    return name
    return "<unknown>"


def get_context_window(lines: List[str], idx: int, window: int = 15) -> str:
    """Retourne les N lignes avant l'appel render pour analyse de contexte."""
    start = max(0, idx - window)
    return "\n".join(lines[start:idx + 1])


def classify(context: str, line: str, render_variant: str, audit_tag: Optional[str]) -> tuple:
    """Retourne (category, risk, todo)."""

    if audit_tag:
        return (
            "AUDIT",
            "MEDIUM",
            f"Tag {audit_tag} déjà identifié — migrer vers rendu partiel du composant concerné"
        )

    is_auto = any(re.search(p, context) for p in AUTO_CONTEXT_PATTERNS)
    is_action = any(re.search(p, context) for p in ACTION_CONTEXT_PATTERNS)

    if is_action and not is_auto:
        return ("ACTION", "LOW", "OK — render suite à action utilisateur")

    if is_auto and not is_action:
        if render_variant == "_render_if_not_interacting":
            return (
                "AUTO",
                "MEDIUM",
                "Protégé par _render_if_not_interacting — à migrer vers rendu partiel"
            )
        else:
            return (
                "AUTO",
                "HIGH",
                "DANGER: _render() brut dans contexte automatique — peut interrompre interactions"
            )

    if is_auto and is_action:
        return (
            "AUTO",
            "MEDIUM",
            "Contexte mixte auto+action — vérifier si le render est nécessaire ici"
        )

    return ("UNKNOWN", "LOW", "Contexte indéterminé — vérification manuelle nécessaire")


# ---------------------------------------------------------------------------
# Analyse principale
# ---------------------------------------------------------------------------

def analyze(filepath: Path) -> List[RenderCall]:
    source = filepath.read_text(encoding="utf-8")
    lines = source.splitlines()

    results: List[RenderCall] = []

    for idx, line in enumerate(lines):
        match = RENDER_CALL_PATTERN.search(line)
        if not match:
            continue

        # Détermine la variante
        render_variant = "_render_if_not_interacting" if "_render_if_not_interacting" in line else "_render"

        # Recherche d'un tag AUDIT dans les 3 lignes précédentes
        audit_tag = None
        for look_back in range(max(0, idx - 3), idx + 1):
            m = AUDIT_TAG_PATTERN.search(lines[look_back])
            if m:
                audit_tag = f"AUDIT-RERENDER-{m.group(1)}"
                break

        # Méthode courante
        method_ctx = detect_current_method(lines, idx)
        tab = TAB_MAP.get(method_ctx, "?")

        # Fenêtre de contexte pour classification
        context = get_context_window(lines, idx)

        category, risk, todo = classify(context, line, render_variant, audit_tag)

        results.append(RenderCall(
            line_no=idx + 1,
            line=line.strip(),
            method_ctx=method_ctx,
            tab=tab,
            category=category,
            audit_tag=audit_tag,
            render_variant=render_variant,
            risk=risk,
            todo=todo,
        ))

    return results


# ---------------------------------------------------------------------------
# Rapport
# ---------------------------------------------------------------------------

RISK_COLORS = {
    "HIGH": "\033[91m",    # rouge
    "MEDIUM": "\033[93m",  # jaune
    "LOW": "\033[92m",     # vert
}
RESET = "\033[0m"
BOLD = "\033[1m"


def print_report(results: List[RenderCall], filepath: Path) -> None:
    print(f"\n{BOLD}=== HSE Panel — Audit re-renders automatiques ==={RESET}")
    print(f"Fichier : {filepath}")
    print(f"Appels render trouvés : {len(results)}\n")

    categories = {"AUTO": [], "ACTION": [], "AUDIT": [], "UNKNOWN": []}
    for r in results:
        categories[r.category].append(r)

    # Synthèse
    print(f"{BOLD}--- Synthèse ---{RESET}")
    for cat, items in categories.items():
        high = sum(1 for x in items if x.risk == "HIGH")
        med = sum(1 for x in items if x.risk == "MEDIUM")
        low = sum(1 for x in items if x.risk == "LOW")
        print(f"  {cat:<10} : {len(items):>3} appels  (HIGH={high}, MEDIUM={med}, LOW={low})")

    # Détail par catégorie
    for cat in ["AUTO", "AUDIT", "UNKNOWN"]:
        items = categories[cat]
        if not items:
            continue
        print(f"\n{BOLD}--- {cat} ---{RESET}")
        for r in items:
            color = RISK_COLORS.get(r.risk, "")
            tag = f" [{r.audit_tag}]" if r.audit_tag else ""
            variant = "_render_if_not_interacting" if r.render_variant == "_render_if_not_interacting" else "_render()"
            print(f"  {color}[{r.risk}]{RESET} L{r.line_no:<5} | {r.method_ctx:<40} | tab={r.tab:<15} | {variant}{tag}")
            print(f"         └─ TODO: {r.todo}")

    # TODO list consolidée
    print(f"\n{BOLD}--- TODO liste pour migration rendu partiel ---{RESET}")
    high_items = [r for r in results if r.risk == "HIGH"]
    med_items = [r for r in results if r.risk == "MEDIUM" and r.category in ("AUTO", "AUDIT")]

    if not high_items and not med_items:
        print("  ✓ Aucun re-render à risque détecté.")
    else:
        priority = 1
        for r in high_items + med_items:
            tag = r.audit_tag or "(non taggé)"
            print(f"  [{priority}] L{r.line_no} {tag} | {r.method_ctx} | tab={r.tab}")
            print(f"       Remplacer par: rendu partiel du composant concerné ({r.render_variant})")
            priority += 1

    print()


def print_json(results: List[RenderCall], filepath: Path) -> None:
    output = {
        "file": str(filepath),
        "total": len(results),
        "summary": {
            "AUTO_HIGH": sum(1 for r in results if r.category == "AUTO" and r.risk == "HIGH"),
            "AUTO_MEDIUM": sum(1 for r in results if r.category == "AUTO" and r.risk == "MEDIUM"),
            "AUDIT": sum(1 for r in results if r.category == "AUDIT"),
            "ACTION": sum(1 for r in results if r.category == "ACTION"),
            "UNKNOWN": sum(1 for r in results if r.category == "UNKNOWN"),
        },
        "calls": [asdict(r) for r in results],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# Entrée principale
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit des re-renders automatiques dans hse_panel.js"
    )
    parser.add_argument(
        "--file", type=Path, default=DEFAULT_FILE,
        help="Chemin vers hse_panel.js (défaut: chemin relatif au repo)"
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Sortie en JSON structuré"
    )
    args = parser.parse_args()

    filepath = args.file
    if not filepath.exists():
        print(f"Erreur: fichier introuvable: {filepath}", file=sys.stderr)
        return 1

    results = analyze(filepath)

    if args.json:
        print_json(results, filepath)
    else:
        print_report(results, filepath)

    # Exit code non-zéro si des HIGH détectés (utile pour CI)
    high_count = sum(1 for r in results if r.risk == "HIGH" and r.category == "AUTO")
    return 1 if high_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
