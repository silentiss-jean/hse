# Guide de contribution & Workflow IA — HSE

Ce fichier explique **exactement quoi faire et quand** pour maintenir la documentation à jour et travailler efficacement avec une IA.

---

## 📖 Table des matières

1. [Travailler avec une IA (Perplexity, Copilot, ChatGPT...)](#1-travailler-avec-une-ia)
2. [Après avoir modifié du code](#2-après-avoir-modifié-du-code)
3. [Convention de commit](#3-convention-de-commit)
4. [Vérifier les docs en retard](#4-vérifier-les-docs-en-retard)

---

## 1. Travailler avec une IA

### Le problème
Quand tu ouvres une nouvelle conversation avec une IA, elle ne connaît pas ton projet.
Elle peut halluciner des noms de fonctions, inventer une architecture, ou te répondre à côté.

### La solution : donner le contexte en 1 phrase

Au **début de chaque nouvelle session IA**, écris simplement :

```
Lis le fichier CONTEXT.md du repo GitHub silentiss-jean/hse
et réponds à ma question : [ta question ici]
```

**Exemple concret :**
```
Lis le fichier CONTEXT.md du repo GitHub silentiss-jean/hse
et réponds à ma question : comment fonctionne le calcul des coûts partagés ?
```

L'IA va alors :
1. Lire `CONTEXT.md` → comprendre l'architecture complète du projet
2. Identifier le bon fichier source (`shared_cost_engine.py`)
3. Lire la doc associée si elle existe
4. Te répondre avec le bon contexte

> ✅ **Tu n'as rien d'autre à faire.** Une seule phrase suffit.

---

## 2. Après avoir modifié du code

Chaque fois que tu modifies un fichier `.py`, tu dois faire **une de ces deux choses** :

### Cas A — L'API ou le comportement a changé

Tu dois mettre à jour le fichier `.md` correspondant dans `custom_components/hse/docs/`.

Pour savoir quel `.md` correspond à ton fichier, consulte le tableau dans `CONTEXT.md`.

**Exemple :** tu modifies `settings_pricing.py`
→ Tu mets à jour `custom_components/hse/docs/pricing_settings.md`

### Cas B — Correction de bug interne, refacto sans changement d'API

Tu n'as pas besoin de mettre à jour la doc.
Mais tu dois le **signaler dans ton commit** (voir section 3).

### Cas C — Nouveau fichier `.py` sans doc existante

Tu dois **créer** un nouveau fichier `.md` dans `custom_components/hse/docs/`.
Nomme-le comme le fichier source : `mon_module.py` → `docs/mon_module.md`.

Structure minimale d'une nouvelle doc :

```markdown
# mon_module.py

## Rôle
Décris en 2-3 phrases ce que fait ce module.

## Dépendances
Liste les autres modules qu'il utilise.

## API publique
Liste les fonctions/classes principales avec leur signature.

## Exemple d'usage
(optionnel) Montre un appel typique.
```

---

## 3. Convention de commit

Tout commit qui touche un fichier `.py` **doit** inclure une mention `[doc: ...]` dans le message.

### Format

```
<type>(<module>): <description courte> [doc: <état>]
```

### Les 3 états possibles

| État | Quand l'utiliser | Exemple |
|---|---|---|
| `[doc: updated X.md]` | Tu as mis à jour la doc | `[doc: updated pricing_settings.md]` |
| `[doc: TODO — créer X.md]` | La doc n'existe pas encore | `[doc: TODO — créer migration_export.md]` |
| `[doc: N/A]` | Bug fix / refacto sans impact sur l'API | `[doc: N/A]` |

### Exemples complets

```bash
# Tu ajoutes une fonctionnalité et tu as mis à jour la doc
git commit -m "feat(catalogue): ajout méthode bulk_reset [doc: updated persistent_catalogue.md]"

# Tu corriges un bug sans toucher l'API publique
git commit -m "fix(scan_engine): correction timeout sur scan vide [doc: N/A]"

# Tu crées un nouveau module et tu n'as pas encore écrit la doc
git commit -m "feat(export): ajout migration_export [doc: TODO — créer migration_export.md]"
```

---

## 4. Vérifier les docs en retard

Un script automatisé compare la date du dernier commit de chaque `.py` avec la date du dernier commit de sa doc associée.

### Lancer le vérificateur

**Depuis la racine du repo :**

```bash
python tools/check_doc_drift.py
```

### Exemple de sortie

```
=== HSE Doc Drift Checker ===

❌ PAS DE DOC: custom_components/hse/shared_cost_engine.py
⚠  DOC PÉRIMÉE: custom_components/hse/meta_sync.py
   src modifié: 2026-03-25 | doc modifiée: 2026-02-10
   → Mettre à jour: custom_components/hse/docs/unified_api.md
✅ OK: custom_components/hse/catalogue_manager.py

--- Résumé ---
  ✅ À jour  : 18
  ⚠  Périmé  : 3
  ❌ Sans doc : 5
```

### Quand le lancer ?

- **Avant** de démarrer une session de développement
- **Avant** de pousser une branche importante
- **En CI** (optionnel) : `python tools/check_doc_drift.py --ci` (retourne exit 1 si drifts)

### Options disponibles

```bash
# Afficher aussi les fichiers OK
python tools/check_doc_drift.py --verbose

# Mode CI (exit code 1 si problème)
python tools/check_doc_drift.py --ci
```

---

## 💡 Résumé en une image

```
Tu modifies du code
        ↓
tu commites avec [doc: ...]
        ↓
tu lances check_doc_drift.py
        ↓
tu mets à jour les .md signalés
        ↓
tu démarres une session IA avec :
"Lis CONTEXT.md du repo silentiss-jean/hse et ..."
        ↓
l'IA a le bon contexte ✅
```
