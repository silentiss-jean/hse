#!/usr/bin/env python3
"""
push_release.py — HSE release helper

Usage:
    python3 tools/push_release.py
    python3 tools/push_release.py --dry-run
    python3 tools/push_release.py --message "Description de la release"
    python3 tools/push_release.py --bump minor
    python3 tools/push_release.py --bump major

Ce script :
  1. Lit le dernier tag git (ex: v2.0.82)
  2. Incrémente le patch (ex: v2.0.83)
  3. Met à jour la version dans manifest.json
  4. Commite le manifest si modifié
  5. Crée le tag git annoté
  6. Pousse le commit + le tag sur origin/main
  7. Crée la GitHub Release via l'API

Prérequis :
  - git configuré avec accès push sur le repo
  - Variable d'environnement GITHUB_TOKEN ou token dans ~/.config/hse/github_token
  - pip install requests  (si absent: le script fonctionne sans pour les étapes git)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# ── Chemins ──────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "custom_components" / "hse" / "manifest.json"
GITHUB_REPO = "silentiss-jean/hse"


# ── Helpers git ──────────────────────────────────────────────────────────────

def run(cmd: list[str], check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, capture_output=capture, text=True, cwd=REPO_ROOT)


def get_latest_tag() -> str | None:
    """Retourne le dernier tag vX.Y.Z ou None."""
    try:
        result = run(["git", "describe", "--tags", "--abbrev=0"])
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        return None


def parse_version(tag: str) -> tuple[int, int, int]:
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)$", tag)
    if not m:
        raise ValueError(f"Tag non reconnu: {tag!r} — attendu vX.Y.Z")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def bump_version(major: int, minor: int, patch: int, bump: str) -> tuple[int, int, int]:
    if bump == "major":
        return major + 1, 0, 0
    if bump == "minor":
        return major, minor + 1, 0
    return major, minor, patch + 1  # default: patch


def format_tag(major: int, minor: int, patch: int) -> str:
    return f"v{major}.{minor}.{patch}"


def get_commits_since_tag(tag: str) -> list[str]:
    """Retourne les messages de commit depuis le tag."""
    try:
        result = run(["git", "log", f"{tag}..HEAD", "--oneline", "--no-decorate"])
        lines = [l.strip() for l in result.stdout.strip().splitlines() if l.strip()]
        return lines
    except subprocess.CalledProcessError:
        return []


def has_uncommitted_changes() -> bool:
    result = run(["git", "status", "--porcelain"])
    return bool(result.stdout.strip())


# ── Manifest ──────────────────────────────────────────────────────────────────

def read_manifest() -> dict:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def write_manifest(data: dict) -> None:
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def update_manifest_version(new_version: str, dry_run: bool = False) -> bool:
    """Met à jour manifest.json avec la nouvelle version. Retourne True si modifié."""
    data = read_manifest()
    current = data.get("version", "")
    # manifest utilise X.Y.Z sans 'v'
    clean = new_version.lstrip("v")
    if current == clean:
        print(f"  manifest.json déjà à {clean}, pas de modification.")
        return False
    print(f"  manifest.json : {current} → {clean}")
    if not dry_run:
        data["version"] = clean
        write_manifest(data)
    return True


# ── GitHub API ────────────────────────────────────────────────────────────────

def get_github_token() -> str | None:
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        return token
    config_file = Path.home() / ".config" / "hse" / "github_token"
    if config_file.exists():
        return config_file.read_text().strip()
    return None


def create_github_release(tag: str, body: str, dry_run: bool = False) -> bool:
    if not HAS_REQUESTS:
        print("  ⚠️  requests non installé — release GitHub ignorée.")
        print("     pip install requests  pour activer cette étape.")
        return False

    token = get_github_token()
    if not token:
        print("  ⚠️  GITHUB_TOKEN absent — release GitHub ignorée.")
        print("     export GITHUB_TOKEN=ghp_xxx  ou créer ~/.config/hse/github_token")
        return False

    if dry_run:
        print(f"  [dry-run] Créerait la release GitHub {tag}")
        return True

    url = f"https://api.github.com/repos/{GITHUB_REPO}/releases"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {
        "tag_name": tag,
        "target_commitish": "main",
        "name": tag,
        "body": body,
        "draft": False,
        "prerelease": False,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=15)
    if resp.status_code == 201:
        data = resp.json()
        print(f"  ✅ Release GitHub créée : {data.get('html_url')}")
        return True
    else:
        print(f"  ❌ Échec création release GitHub : {resp.status_code}")
        print(f"     {resp.text[:300]}")
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="HSE — Créer et pousser une release")
    parser.add_argument("--dry-run", action="store_true", help="Simule sans rien modifier")
    parser.add_argument("--bump", choices=["patch", "minor", "major"], default="patch",
                        help="Type de bump (défaut: patch)")
    parser.add_argument("--message", "-m", default="",
                        help="Message/description de la release")
    args = parser.parse_args()

    dry = args.dry_run
    if dry:
        print("🔍 Mode dry-run — aucune modification ne sera effectuée.\n")

    # 1. Récupérer le dernier tag
    latest_tag = get_latest_tag()
    if not latest_tag:
        print("❌ Aucun tag trouvé. Crée un premier tag manuellement : git tag v2.0.0")
        sys.exit(1)
    print(f"📌 Dernier tag : {latest_tag}")

    # 2. Calculer le nouveau tag
    major, minor, patch = parse_version(latest_tag)
    new_major, new_minor, new_patch = bump_version(major, minor, patch, args.bump)
    new_tag = format_tag(new_major, new_minor, new_patch)
    print(f"🚀 Nouveau tag  : {new_tag}  (bump: {args.bump})")

    # 3. Commits depuis le dernier tag
    commits = get_commits_since_tag(latest_tag)
    if commits:
        print(f"\n📝 {len(commits)} commit(s) depuis {latest_tag} :")
        for c in commits:
            print(f"   • {c}")
    else:
        print(f"\n⚠️  Aucun commit depuis {latest_tag}.")
        if not dry:
            answer = input("Continuer quand même ? [y/N] ").strip().lower()
            if answer != "y":
                print("Annulé.")
                sys.exit(0)

    # 4. Corps de la release
    if args.message:
        release_body = args.message
    elif commits:
        lines = [f"- {c}" for c in commits]
        release_body = f"## Changements depuis {latest_tag}\n\n" + "\n".join(lines)
    else:
        release_body = f"Release {new_tag}"

    # 5. Mettre à jour manifest.json
    print(f"\n📦 Mise à jour manifest.json...")
    manifest_updated = update_manifest_version(new_tag, dry_run=dry)

    if manifest_updated and not dry:
        # 6. Commiter le manifest
        print("\n💾 Commit du manifest...")
        run(["git", "add", str(MANIFEST_PATH)])
        run(["git", "commit", "-m",
             f"chore(release): bump version to {new_tag} [doc: N/A]"])
        print("  ✅ Commit créé.")

    # 7. Créer le tag annoté
    print(f"\n🏷️  Création du tag {new_tag}...")
    if not dry:
        run(["git", "tag", "-a", new_tag, "-m", f"Release {new_tag}"])
        print(f"  ✅ Tag {new_tag} créé.")
    else:
        print(f"  [dry-run] git tag -a {new_tag} -m 'Release {new_tag}'")

    # 8. Pousser commits + tag
    print("\n📤 Push origin main + tag...")
    if not dry:
        run(["git", "push", "origin", "main"])
        run(["git", "push", "origin", new_tag])
        print("  ✅ Push effectué.")
    else:
        print("  [dry-run] git push origin main")
        print(f"  [dry-run] git push origin {new_tag}")

    # 9. Créer la GitHub Release
    print("\n🌐 Création de la release GitHub...")
    create_github_release(new_tag, release_body, dry_run=dry)

    print(f"\n✅ Release {new_tag} terminée !")
    if dry:
        print("   (dry-run : rien n'a été modifié)")


if __name__ == "__main__":
    main()
