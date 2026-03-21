# Architecture actuelle (état courant)

> Mis à jour après la Phase 9 — `overview.state.js` + `patch_live` sur l'onglet Accueil (fin du scroll-jack).
> Fix 2026-03-20 : `data-hse-cards-dom-ready` retiré dans `_set_active_tab` (cards page vide au retour d'onglet).

## Vue d'ensemble

L'intégration est structurée autour de quatre couches principales :

1. **Bootstrap / runtime** : `__init__.py`
2. **Stores partagés** : `catalogue_*`, `meta_*`
3. **API unifiée** : `api/unified_api.py` + `api/views/*`
4. **Panel frontend** : `web_static/panel/*`

Le point d'organisation n'est plus « un onglet = un état local », mais « un micro-store réactif partagé + des state files par feature + un panel entrypoint léger ».

---

## 1) Bootstrap / runtime

Le point d'entrée `__init__.py` :

- enregistre l'API unifiée ;
- expose les assets statiques du panel ;
- enregistre un panel HA unique (`hse-panel`) ;
- charge et persiste les stores `catalogue` et `meta` ;
- lance les boucles périodiques de refresh catalogue et de synchronisation meta.

---

## 2) Catalogue

Le catalogue est un **registre métier persistant** : identité des items, source observée, santé/escalade, triage, enrichissement.

### Vues exposées

- `CatalogueGetView` / `CatalogueRefreshView`
- `CatalogueItemTriageView` / `CatalogueTriageBulkView`
- `CatalogueReferenceTotalView`

---

## 3) Meta

Store distinct du catalogue. Suit la structure HA (areas, entités, affectations) et produit des suggestions d'alignement.

### Cycle

`preview` → validation UI → `apply` (`auto` ou `all`) → persistance.

---

## 4) Pricing

Stocké dans `catalogue.settings.pricing`. Contient `contract_type`, `cost_entity_ids`, prix énergie, etc.

**Invariants** : `reference_total` ne peut jamais figurer dans `cost_entity_ids` (garde-fou frontend + backend).

---

## 5) API unifiée

`api/unified_api.py` est le registre central. Familles : scan/catalogue, pricing, meta, enrichissement, migration, overview.

---

## 6) Overview

`dashboard_overview.py` agrège puissance live, `reference_total`, delta, résumé `meta_sync` et warnings.

---

## 7) Enrichissement / migration

`EnrichApplyView` crée les helpers HA via config flows (`utility_meter`), avec preview/diagnose/rollback.

Convention : `sensor.<base>_kwh_total`, `_day`, `_week`, `_month`, `_year`.

---

## 8) Référence totale

Flux UI dédié dans l'onglet Configuration : `get_reference_total_status()`, polling frontend, bloc de progression workflow, snapshot persistant `item.workflow.reference_enrichment`.

---

## 9) Frontend — Architecture micro-store (Phases 1 → 9)

### 9.1) `hse.store.js` — micro-store réactif (Phase 1)

Instance globale `window.hse_store` partagée entre tous les modules.

| Méthode | Rôle |
|---|---|
| `store.get(key)` | Lire une valeur |
| `store.set(key, value)` | Écrire + notifier |
| `store.patch(key, partial)` | Merge shallow + notifier |
| `store.subscribe(key, fn)` | S'abonner aux changements |
| `store.freeze(key)` | Geler (immunise contre `set()` concurrent pendant `confirm()`) |
| `store.unfreeze(key)` | Dégeler |
| `store.snapshot(key)` | Deep clone sûr |

**Race condition corrigée** (Phase 1) : `freeze('org.meta_draft')` + `set('org.saving', true)` avant `window.confirm()` dans `_org_save_meta` et `_org_apply` empêche le polling HA d'écraser le draft.

### 9.2) State files par feature

Chaque onglet complexe possède un state file dédié chargé juste après le store au boot :

#### `config.state.js` (Phase 7)

Expose `window.hse_config_state`. Préfixe store : `config.*`.

- Gère toutes les clés de l'onglet Configuration (`catalogue`, `pricing_draft`, `reference_status`, `cost_filter_q`, etc.).
- **Persistance localStorage** : subscriber `config.cost_filter_q` → `hse_config_cost_filter_q`.
- Restauration au boot depuis localStorage.
- Expose `get_model({})`, `begin_loading`, `end_loading`, `begin_saving`, `end_saving`, etc.

#### `diag.state.js` (Phase 7 → 8)

Expose `window.hse_diag_state`. Préfixe store : `diag.*`.

- Gère toutes les clés de l'onglet Diagnostic (`data`, `loading`, `error`, `filter_q`, `selected`, `advanced`, `check_result`, etc.).
- **Persistance localStorage** : subscribers `filter_q` → `hse_diag_filter_q`, `advanced` → `hse_diag_advanced`, `selected` → `hse_diag_selected`.
- Restauration au boot depuis localStorage.
- **Phase 8** : `data` / `loading` / `error` migrés dans le store — exposés via `begin_fetch()` / `end_fetch(data, error)`.
- Expose `get_state({})`, `begin_fetch`, `end_fetch`, `begin_check`, `end_check`, `set_selected`, `clear_selected`.

#### `overview.state.js` (Phase 9)

Expose `window.hse_overview_state`. Préfixe store : `overview.*`.

| Clé store | Type | Rôle |
|---|---|---|
| `overview.data` | `object\|null` | Réponse dashboard complète |
| `overview.loading` | `bool` | Fetch en cours |
| `overview.error` | `string\|null` | Dernière erreur fetch |
| `overview.tax_mode` | `"ht"\|"ttc"` | Mode taxe affiché |
| `overview.costs_open` | `bool` | Section coûts dépliée |

- **Persistance localStorage** : `tax_mode` → `hse_overview_tax_mode`, `costs_open` → `hse_overview_costs_open`.
- Restauration au boot depuis localStorage.
- **Résout le scroll-jack** : subscriber `overview.data` appelle `patch_live()` sur le DOM existant au lieu d'un `clear()` + rebuild complet toutes les 30s.
- Expose `get_state({})`, `begin_fetch`, `end_fetch`, `register_container(el, hass)`, `update_hass(hass)`.

**Contrat `patch_live`** : `hse_panel.js` appelle `register_container(el, hass)` une seule fois au premier render. Le subscriber `overview.data` appelle ensuite `window.hse_overview_view.patch_live(container, { dashboard }, hass)` à chaque mise à jour de données, sans jamais détruire le DOM.

> **Note pattern** : contrairement à `_diag_state` et `_config_state` qui ont un proxy local dans
> `hse_panel.js`, `_overview_state` n'en a pas. Les méthodes métier (`begin_fetch`, `end_fetch`,
> `register_container`, `update_hass`) sont appelées directement via
> `window.hse_overview_state?.method?.()`. Ce choix est intentionnel : l'API overview ne se
> réduit pas à get/set.

### 9.3) `hse_panel.js` — entrypoint allégé (Phase 9)

`build_signature: 2026-03-20_refonte_store_phase9` — `ASSET_V: 0.1.37`

**Ce qui a été retiré de `hse_panel.js`** :

- `this._diag_state` (objet local `{ loading, data, error }`) → **supprimé** ; tout passe par `_dg()` / `_ds()` via `window.hse_diag_state`.
- `this._config_state` → **supprimé** dès Phase 6 ; tout passe par `_cg()` / `_cs()` via `window.hse_config_state`.
- Tous les `_storage_set(...)` redondants pour `filter_q`, `advanced`, `selected` (diag) et `cost_filter_q` (config) → **supprimés** ; délégués aux subscribers des state files.
- Restauration localStorage dans `connectedCallback` pour les clés diag/config → **supprimée** ; gérée par les state files au boot.

**Ce qui reste dans `hse_panel.js`** :

- État local légitime : `_active_tab`, `_overview_data`, `_scan_state`, `_migration_state`, `_custom_state`, `_org_state` (bridge store).
- Orchestration du routing (`_render()` → `switch(active_tab)`).
- Gestion `_user_interacting` / `_render_for_active_tab` / guards.
- Boot sequence (chargement séquentiel des scripts + CSS).

**Guards DOM onglet cards** :

`_set_active_tab` retire **trois** attributs à chaque changement d'onglet :

```js
this._ui.content.removeAttribute("data-hse-config-built");
this._ui.content.removeAttribute("data-hse-cards-built");
this._ui.content.removeAttribute("data-hse-cards-dom-ready"); // Fix 2026-03-20
```

> **Pourquoi `data-hse-cards-dom-ready` doit être retiré** : cet attribut est posé par
> `cards.controller.js` sur le container après le premier build du layout. Si on quitte
> puis revient sur l'onglet, `hse_dom.clear()` vide les enfants mais laisse les attributs
> du container intact. Le guard principal de `render_cards` (`_instance &&
> container.hasAttribute("data-hse-cards-dom-ready")`) court-circuitait alors tout le
> rebuild → page vide. En retirant l'attribut dans `_set_active_tab`, le guard est
> correctement réinitialisé à chaque changement d'onglet.

### 9.4) Ordre de chargement au boot (ordre réel)

```
dom.js → table.js
→ hse.store.js                         (store central — doit être en premier)
→ diag.state.js                        (state bridge diagnostic)
→ config.state.js                      (state bridge config)
→ shell.js
→ overview.api.js
→ overview.state.js                    (après store + shell, avant overview.view.js)
→ overview.view.js
→ costs.view.js
→ scan.api.js → scan.view.js
→ custom.view.js
→ diagnostic.api.js → diagnostic.view.js
→ enrich.api.js
→ migration.api.js → migration.view.js
→ config.api.js → config.view.js
→ cards.api.js → yamlComposer.js → cards.view.js → cards.controller.js
→ CSS : hse_tokens.shadow.css, hse_themes.shadow.css, hse_alias.v2.css, tokens.css, cards.css
```

Le store et les state files sont **toujours chargés avant** les vues features.

### 9.5) Thème / tokens CSS

Variables HSE tokenisées dans `hse_tokens.shadow.css`, thèmes dans `hse_themes.shadow.css`, aliases dans `hse_alias.v2.css`. Ne pas ajouter de styles locaux non tokenisés.

---

## 10) État d'ensemble

- Runtime central + stores backend partagés
- API unifiée, panel unique
- Pricing centralisé avec garde-fous
- Convention enrichissement helpers stable
- Micro-store frontend réactif (`hse_store`) avec freeze/unfreeze
- State files dédiés par feature (`config.state.js`, `diag.state.js`, `overview.state.js`) avec persistance localStorage déléguée
- `hse_panel.js` réduit à l'orchestration pure
- Onglet Accueil sans scroll-jack via `patch_live` + `register_container`
- `build_signature` et `ASSET_V` alignés sur Phase 9 ✅
- Fix cards DOM guard : `data-hse-cards-dom-ready` retiré dans `_set_active_tab` ✅

## 11) Prochaines étapes potentielles

- Généraliser le contrat de statut de workflow (aujourd'hui spécifique à `reference_total`) pour couvrir d'autres opérations longues.
- Compléter les champs de coûts dans `dashboard_overview.py` (actuellement à `None`).
- Envisager un state file pour `org` / `migration` si leur complexité augmente.
