#!/usr/bin/env python3
"""
ask_ai_update_docs.py — Lance check_doc_drift.py et génère le prompt IA à copier-coller.

Usage:
    python tools/ask_ai_update_docs.py
    python tools/ask_ai_update_docs.py --copy   (copie le prompt dans le presse-papiers)
"""

import subprocess
import sys
import argparse
from pathlib import Path

REPO = "silentiss-jean/hse"
BRANCH = "main"


def run_drift_check() -> str:
    """Lance check_doc_drift.py et capture la sortie."""
    result = subprocess.run(
        [sys.executable, "tools/check_doc_drift.py", "--verbose"],
        capture_output=True,
        text=True
    )
    return result.stdout


def extract_issues(report: str) -> dict:
    """Parse le rapport pour extraire périmés et sans-doc."""
    outdated = []
    no_doc = []
    current_outdated = None

    for line in report.splitlines():
        if "⚠  DOC PÉRIMÉE" in line or "⚠  DOC PERIMEE" in line:
            src = line.split(": ", 1)[-1].strip()
            current_outdated = {"src": src, "update": []}
        elif current_outdated and "→ Mettre à jour:" in line:
            docs = line.split("→ Mettre à jour:")[-1].strip()
            current_outdated["update"] = [d.strip() for d in docs.split(",")]
            outdated.append(current_outdated)
            current_outdated = None
        elif "❌ PAS DE DOC" in line:
            src = line.split(": ", 1)[-1].strip()
            no_doc.append(src)

    return {"outdated": outdated, "no_doc": no_doc}


def build_prompt(issues: dict, report: str) -> str:
    outdated = issues["outdated"]
    no_doc = issues["no_doc"]

    if not outdated and not no_doc:
        return "Toutes les docs sont à jour ✅ — rien à faire."

    lines = []
    lines.append(f"Lis AI_INSTRUCTIONS.md et CONTEXT.md du repo GitHub {REPO} sur la branche {BRANCH}.")
    lines.append("")
    lines.append("Voici le rapport du script check_doc_drift.py :")
    lines.append("")
    lines.append("```")
    # Filtre les lignes ANSI (couleurs terminal)
    clean_report = ""
    import re
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m')
    clean_report = ansi_escape.sub('', report)
    lines.append(clean_report.strip())
    lines.append("```")
    lines.append("")
    lines.append("Ta mission :")
    lines.append("")

    task_num = 1

    if outdated:
        lines.append(f"{task_num}. **Mettre à jour les docs périmées suivantes** (lire le fichier source d'abord, puis écrire la doc) :")
        for item in outdated:
            docs_str = ", ".join(f"`{d}`" for d in item["update"])
            lines.append(f"   - Source modifiée : `{item['src']}` → Doc à mettre à jour : {docs_str}")
        task_num += 1
        lines.append("")

    if no_doc:
        lines.append(f"{task_num}. **Créer les docs manquantes** pour ces fichiers (lire le fichier source, créer un .md dans `custom_components/hse/docs/`) :")
        for src in no_doc:
            lines.append(f"   - `{src}`")
        task_num += 1
        lines.append("")

    lines.append(f"{task_num}. **Mettre à jour `CONTEXT.md`** si de nouveaux fichiers .md ont été créés.")
    lines.append("")
    lines.append("Pousse tout dans un seul commit avec le message :")
    lines.append("`docs: mise à jour automatique des docs depuis rapport drift [doc: updated]`")

    return "\n".join(lines)


def copy_to_clipboard(text: str):
    """Copie dans le presse-papiers (macOS/Linux/Windows)."""
    try:
        import platform
        system = platform.system()
        if system == "Darwin":
            subprocess.run(["pbcopy"], input=text.encode(), check=True)
        elif system == "Linux":
            subprocess.run(["xclip", "-selection", "clipboard"], input=text.encode(), check=True)
        elif system == "Windows":
            subprocess.run(["clip"], input=text.encode(), check=True)
        return True
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description="Génère le prompt IA depuis le rapport drift.")
    parser.add_argument("--copy", "-c", action="store_true", help="Copie le prompt dans le presse-papiers")
    args = parser.parse_args()

    print("\n🔍 Analyse des drifts en cours...\n")
    report = run_drift_check()
    issues = extract_issues(report)

    outdated_count = len(issues["outdated"])
    no_doc_count = len(issues["no_doc"])

    if not outdated_count and not no_doc_count:
        print("✅ Toutes les docs sont à jour. Rien à faire.")
        return

    print(f"📊 Résultat : {outdated_count} doc(s) périmée(s), {no_doc_count} doc(s) manquante(s)\n")

    prompt = build_prompt(issues, report)

    print("=" * 60)
    print("  PROMPT À COLLER DANS L'IA :")
    print("=" * 60)
    print()
    print(prompt)
    print()
    print("=" * 60)

    if args.copy:
        success = copy_to_clipboard(prompt)
        if success:
            print("\n✅ Prompt copié dans le presse-papiers !")
        else:
            print("\n⚠  Impossible de copier automatiquement. Copiez le texte ci-dessus.")
    else:
        print("\n💡 Astuce : relancez avec --copy pour copier automatiquement dans le presse-papiers.")
        print("         python tools/ask_ai_update_docs.py --copy")


if __name__ == "__main__":
    main()
