# Architecture actuelle (état courant)

> Document de maintenance mis à jour après l’ajout du suivi de workflow `reference_total` dans l’UI Configuration et après consolidation du flux d’enrichissement helpers.

## Vue d’ensemble

L’intégration est structurée autour de quatre couches principales :

1. **Bootstrap / runtime** : `__init__.py`
2. **Stores partagés** : `catalogue_*`, `meta_*`
3. **API unifiée** : `api/unified_api.py` + `api/views/*`
4. **Panel frontend** : `web_static/panel/*`

Le point important n’est plus “un onglet = un backend”, mais bien “un runtime + des stores + une API unifiée + un panel unique”.

## 1) Bootstrap / runtime

Le point d’entrée `__init__.py` :

- enregistre l’API unifiée ;
- expose les assets statiques du panel ;
- enregistre un panel HA unique (`hse-panel`) ;
- charge et persiste les stores `catalogue` et `meta` ;
- lance les boucles périodiques de refresh catalogue et de synchronisation meta.

Le runtime expose déjà des capacités transverses réelles, mais elles restent concentrées sur **scan / fusion catalogue / sync meta / persistence**.

## 2) Catalogue

Le refresh catalogue scanne les `sensor.*`, détecte leur nature (`power` / `energy`), ignore les entités HSE générées, puis fusionne le résultat dans un store persistant.

### Rôle actuel du catalogue

Le catalogue est un **registre métier persistant** :

- identité stable des items ;
- source observée actuelle (`entity_id`, `kind`, `unit`, `device_class`, `integration_domain`, `status`, etc.) ;
- santé / indisponibilité / escalade ;
- triage (`policy`, `mute_until`, `note`) ;
- enrichissement / règles de référence totale.

### Vues catalogue exposées

- `CatalogueGetView` renvoie le store partagé `catalogue`.
- `CatalogueRefreshView` délègue à `catalogue_refresh`.
- `CatalogueItemTriageView` met à jour le triage d’un item.
- `CatalogueTriageBulkView` applique le triage en lot.
- `CatalogueReferenceTotalView` gère le capteur de référence totale et impose `enrichment.include = False`.

### Point important

Le catalogue n’est pas une simple liste brute de détection. C’est la **source métier partagée** consommée par plusieurs vues et plusieurs écrans.

## 3) Meta

Le bloc `meta` constitue un second store partagé, distinct du catalogue. Il sert à suivre la structure HA (areas, entités, affectations) et à produire des suggestions d’alignement sans écraser brutalement les choix manuels.

### Ce que fait `meta_sync`

`async_build_ha_snapshot` extrait un snapshot des areas et des `sensor.*` présents dans l’entity registry. `compute_pending_diff` produit ensuite les créations / renommages / suggestions nécessaires.

### Cycle actuel

Le flux est maintenant clairement :

- `preview` ;
- validation / inspection UI ;
- `apply` (`auto` ou `all`) ;
- persistance.

Le store `meta` est donc un **modèle métier éditable**, pas seulement une projection calculée.

## 4) Pricing

La configuration tarifaire est portée par `settings/pricing` et stockée dans `catalogue.settings.pricing`.

### Modèle actuel

Le backend stocke notamment :

- `contract_type` ;
- `display_mode` ;
- `subscription_monthly` ;
- `cost_entity_ids` ;
- les prix énergie selon le contrat ;
- `updated_at`.

### Invariants métier

- la TVA n’est jamais déduite implicitement ;
- le capteur `reference_total` ne peut jamais apparaître dans `cost_entity_ids` ;
- le pricing est validé et persisté côté backend.

## 5) API unifiée

`api/unified_api.py` est le registre central des endpoints exposés par l’intégration.

### Familles de vues

- Base panel / disponibilité
- Scan / catalogue
- Pricing
- Meta
- Enrichissement
- Migration / export
- Overview / dashboard

### Lecture fonctionnelle

La bonne direction n’est pas de recréer des backends parallèles, mais d’augmenter la cohérence de cette couche unique.

## 6) Overview

`dashboard_overview.py` est un endpoint d’agrégation et de tolérance, pas encore un moteur de coût complet.

### Ce qu’il calcule vraiment

- relit `catalogue.settings.pricing` ;
- relit `cost_entity_ids` ;
- reconstruit la sélection et la puissance live ;
- somme la puissance live ;
- relit le capteur `reference_total` ;
- calcule un `delta.power_w` si la référence est disponible ;
- remonte un résumé `meta_sync` et des warnings.

### Ce qui reste vide

Les structures de coûts et de tableaux existent déjà, mais beaucoup de champs restent à `None`.

## 7) Enrichissement / migration

Les vues d’enrichissement et d’export montrent qu’une partie importante de la logique métier vise déjà à standardiser les entités dérivées.

### Enrichissement helpers

`EnrichPreviewView` et `EnrichApplyView` partent par défaut de `pricing.cost_entity_ids`, filtrent les capteurs `power`, dérivent un `base slug`, puis construisent une convention commune :

- `sensor.<base>_kwh_total`
- `sensor.<base>_kwh_day`
- `sensor.<base>_kwh_week`
- `sensor.<base>_kwh_month`
- `sensor.<base>_kwh_year`

`EnrichApplyView` sait déjà créer réellement les helpers Home Assistant via config flows `integration` puis `utility_meter`, avec preview, diagnose, cleanup et rollback/safe mode autour du même modèle.

### Conséquence importante

Le **mécanisme de création des helpers** est donc déjà générique pour les capteurs de puissance sélectionnés. Ce n’est pas un mécanisme réservé au capteur de référence totale.

## 8) Référence totale : état courant

Le flux `reference_total` possède désormais une couche UI dédiée dans l’onglet Configuration.

### Ce qui existe maintenant

- endpoint frontend `get_reference_total_status()` ;
- endpoint backend `GET hse/unified/catalogue/reference_total/status` ;
- bloc visuel de progression du workflow dans la vue Configuration ;
- réutilisation d’un snapshot persistant `item.workflow.reference_enrichment` quand disponible ;
- polling frontend pour suivre l’état courant ;
- garde-fou pour éviter l’affichage d’un statut périmé lors des changements rapides de référence.

### Lecture fonctionnelle

Le **contrat de statut de workflow** n’est pas encore générique. Aujourd’hui, cette brique de suivi d’état est spécifique à `reference_total`, alors que le **mécanisme de création des helpers** est déjà plus général côté enrichissement.

## 9) Frontend / thème

La couche UI est compatible avec une évolution par tokens CSS et variables HSE.

La bonne pratique reste :

- ajouter des variables HSE quand un besoin visuel est récurrent ;
- brancher ces variables dans la couche d’alias/tokens ;
- éviter les styles locaux non tokenisés.

## 10) Implication pour l’unification

L’état actuel montre déjà :

- un runtime central ;
- des stores partagés ;
- une API unifiée ;
- un panel unique ;
- un pricing centralisé ;
- une convention enrichissement helpers déjà stable ;
- un flux UI spécifique de suivi `reference_total` ;
- une base saine pour factoriser ensuite un contrat de statut de workflow plus générique.

## 11) Décision recommandée

La prochaine étape n’est pas de recopier le flux `reference_total` partout, mais de faire émerger une **couche commune de statut de workflow** réutilisable :

- pour `reference_total` ;
- pour les créations de helpers enrichissement quand un suivi d’état utilisateur est utile ;
- sans dupliquer le polling et le rendu capteur par capteur.
