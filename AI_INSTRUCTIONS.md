# Instructions systématiques pour l'IA — HSE

> Ce fichier est destiné à être lu par toute IA (Perplexity, Copilot, ChatGPT, Claude...)
> **avant** d'effectuer toute modification sur ce repo.
> Il définit les règles non-négociables à respecter automatiquement.

---

## Règle #1 — Toujours lire CONTEXT.md en premier

Avant toute action sur ce repo, lis `CONTEXT.md`.
Ce fichier contient :
- L'architecture complète du projet
- Le mapping de chaque fichier `.py` vers sa documentation `.md`
- La liste des docs manquantes
- La version courante

Sans lire `CONTEXT.md`, tu risques de travailler sur un mauvais fichier ou de casser une convention existante.

---

## Règle #2 — Chaque commit qui modifie un `.py` DOIT inclure la doc

### Ce que tu dois faire à chaque commit :

**Étape 1** : Identifie quel(s) fichier(s) `.py` tu as modifié.

**Étape 2** : Consulte le tableau dans `CONTEXT.md` pour trouver le(s) `.md` associé(s).

**Étape 3** : Applique une des quatre actions suivantes :

| Situation | Action requise | Tag commit |
|---|---|---|
| L'API publique ou le comportement a changé | Mettre à jour le `.md` associé **dans le même commit** | `[doc: updated nom_du_fichier.md]` |
| Bug fix / refacto interne sans impact API | Pas de mise à jour doc | `[doc: N/A]` |
| Nouveau fichier `.py` sans doc existante | Créer le `.md` correspondant dans `docs/` **dans le même commit** | `[doc: created nom_du_fichier.md]` |
| Nouveau fichier `.py` dont la doc sera créée dans un commit séparé | Ne pas créer la doc maintenant, ouvrir une issue pour le suivi | `[doc: TODO - créer nom_du_fichier.md]` |

> **⚠️ Privilégier `created` sur `TODO`** : le tag `TODO` est toléré uniquement si la création
> de doc nécessite une session dédiée (module complexe, API encore instable).
> Dans tous les autres cas, crée la doc dans le même commit.

**Étape 4** : Formule le message de commit avec le tag `[doc: ...]` :

```
# Doc mise à jour
feat(catalogue): ajout méthode bulk_reset [doc: updated persistent_catalogue.md]

# Bug fix sans impact doc
fix(scan_engine): correction timeout sur scan vide [doc: N/A]

# Nouveau module, doc créée dans le même commit
feat(export): ajout migration_export [doc: created migration_export.md]

# Nouveau module complexe, doc à créer dans un commit dédié
feat(cost): ajout shared_cost_engine [doc: TODO - créer shared_cost_engine.md]
```

---

## Règle #3 — Mettre à jour CONTEXT.md si l'architecture change

Si tu :
- Ajoutes un nouveau fichier `.py`
- Supprimes un fichier `.py`
- Crées une nouvelle doc `.md`
- Modifies le rôle d'un module

→ Tu dois mettre à jour les tableaux dans `CONTEXT.md` dans le même commit.
Mets aussi à jour la date en haut : `> Dernière mise à jour : YYYY-MM-DD`

---

## Règle #4 — Structure d'une nouvelle doc `.md`

Si tu dois créer une nouvelle doc, utilise cette structure :

```markdown
# nom_du_fichier.py

> Dernière mise à jour : YYYY-MM-DD

## Rôle
Description en 2-3 phrases de ce que fait ce module.

## Dépendances
- Liste des modules HSE utilisés
- Libraries externes si pertinent

## API publique

### `nom_fonction(param: type) -> type`
Description courte.

**Paramètres :**
- `param` : description

**Retourne :** description

## Comportement important / edge cases
(Si pertinent) Signale les comportements non-évidents.
```

---

## Règle #5 — Ne jamais supposer, toujours lire le fichier source

Si tu dois documenter ou modifier un comportement, **lis toujours le fichier source** directement depuis le repo GitHub avant d'écrire quoi que ce soit.
Ne jamais inventer une signature de fonction ou un comportement.

---

## Check-list rapide avant chaque commit

```
☐ J'ai lu CONTEXT.md
☐ J'ai identifié les .py modifiés
☐ J'ai mis à jour ou créé les .md correspondants (ou justifié [doc: N/A] ou [doc: TODO])
☐ J'ai mis à jour CONTEXT.md si l'architecture a changé
☐ Mon message de commit contient [doc: ...]
```
