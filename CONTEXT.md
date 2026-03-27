# HSE — Contexte IA

> **Point d'entrée obligatoire pour toute session IA sur ce projet.**
> Dernière mise à jour : 2026-03-27

---

## Résumé du projet

**Home Suivi Élec (HSE)** est une intégration custom Home Assistant pour le suivi détaillé de la consommation électrique par appareil, avec calcul de coûts, enrichissement de métadonnées et panel web embarqué.

- **Domaine HA** : `hse`
- **Version courante** : `2.0.1` (voir `custom_components/hse/manifest.json`)
- **Classe IoT** : `local_polling`
- **Dépôt principal** : https://github.com/silentiss-jean/hse
- **Issue tracker** : https://github.com/silentiss-jean/hseV2/issues

---

## Architecture — Modules principaux

### Bootstrap / Intégration HA
| Fichier | Rôle | Doc associée |
|---|---|---|
| `custom_components/hse/__init__.py` | Setup de l'intégration, chargement des platforms, bootstrap | `docs/init_py.md` |
| `custom_components/hse/config_flow.py` | Flow de configuration HA (UI) | `docs/config_flow.md` |
| `custom_components/hse/const.py` | Constantes globales | `docs/const.md` |
| `custom_components/hse/manifest.json` | Métadonnées HA (version, domaine, requirements) | `docs/manifest.md` |
| `custom_components/hse/repairs.py` | Gestion des issues/repairs HA | ❌ pas de doc |
| `custom_components/hse/time_utils.py` | Utilitaires de gestion du temps | ❌ pas de doc |

### Catalogue des appareils
| Fichier | Rôle | Doc associée |
|---|---|---|
| `custom_components/hse/catalogue_defaults.py` | Valeurs par défaut du catalogue | `docs/persistent_catalogue.md` |
| `custom_components/hse/catalogue_manager.py` | Gestionnaire principal du catalogue | `docs/persistent_catalogue.md` |
| `custom_components/hse/catalogue_schema.py` | Schéma de validation du catalogue | `docs/persistent_catalogue.md` |
| `custom_components/hse/catalogue_store.py` | Persistance du catalogue (JSON store) | `docs/persistent_catalogue.md` |

### Métadonnées & Sync
| Fichier | Rôle | Doc associée |
|---|---|---|
| `custom_components/hse/meta_schema.py` | Schéma des métadonnées | `docs/unified_api.md` |
| `custom_components/hse/meta_store.py` | Persistance des métadonnées | `docs/unified_api.md` |
| `custom_components/hse/meta_sync.py` | Synchronisation des métadonnées avec HA | `docs/unified_api.md` |

### Moteurs de calcul
| Fichier | Rôle | Doc associée |
|---|---|---|
| `custom_components/hse/shared_cost_engine.py` | Calcul des coûts partagés par appareil | ❌ pas de doc |
| `custom_components/hse/scan_engine.py` | Moteur de scan des entités HA | `docs/entities_scan.md` |

### API REST (endpoints)
| Fichier | Rôle | Doc associée |
|---|---|---|
| `custom_components/hse/api/unified_api.py` | Routeur principal des endpoints | `docs/unified_api.md` / `docs/overview_api.md` |
| `api/views/ping.py` | Health check | ❌ pas de doc |
| `api/views/catalogue_get.py` | GET catalogue | `docs/overview_api.md` |
| `api/views/catalogue_refresh.py` | Force refresh du catalogue | `docs/overview_api.md` |
| `api/views/catalogue_item_triage.py` | Triage d'un item du catalogue | `docs/overview_api.md` |
| `api/views/catalogue_triage_bulk.py` | Triage en masse | `docs/overview_api.md` |
| `api/views/catalogue_reference_total.py` | Calcul de la référence totale | ❌ pas de doc |
| `api/views/costs_compare.py` | Comparaison des coûts | ❌ pas de doc |
| `api/views/dashboard_overview.py` | Données du dashboard | `docs/overview_view.md` |
| `api/views/diagnostic_check.py` | Diagnostic de l'intégration | ❌ pas de doc |
| `api/views/enrich_apply.py` | Application de l'enrichissement | ❌ pas de doc |
| `api/views/enrich_cleanup.py` | Nettoyage des enrichissements | ❌ pas de doc |
| `api/views/enrich_diagnose.py` | Diagnostic de l'enrichissement | ❌ pas de doc |
| `api/views/enrich_preview.py` | Prévisualisation de l'enrichissement | ❌ pas de doc |
| `api/views/entities_scan.py` | Scan des entités HA via API | `docs/entities_scan.md` / `docs/scan_api.md` |
| `api/views/frontend_manifest.py` | Manifest du frontend | ❌ pas de doc |
| `api/views/meta.py` | CRUD métadonnées via API | `docs/unified_api.md` |
| `api/views/meta_sync_apply.py` | Application d'une sync de méta | `docs/unified_api.md` |
| `api/views/meta_sync_preview.py` | Prévisualisation sync méta | `docs/unified_api.md` |
| `api/views/migration_export.py` | Export pour migration | ❌ pas de doc |
| `api/views/settings_pricing.py` | CRUD des paramètres de tarification | `docs/pricing_settings.md` |

### Frontend (Panel web)
| Fichier/Dossier | Rôle | Doc associée |
|---|---|---|
| `custom_components/hse/web_static/` | Assets statiques du panel (HTML/JS/CSS) | `docs/hse_panel.md` |
| `custom_components/hse/translations/` | Fichiers de traduction HA | ❌ pas de doc |

---

## Documentation disponible (`custom_components/hse/docs/`)

| Fichier doc | Sujet |
|---|---|
| `README.md` | Index de la documentation |
| `architecture_current_state.md` | Architecture générale |
| `config_flow.md` | Configuration HA |
| `config_ui.md` | UI de configuration |
| `const.md` | Constantes |
| `custom_view.md` | Vue custom |
| `dom_js.md` | DOM & JS |
| `entities_scan.md` | Scan des entités |
| `hse_alias_v2_css.md` | Alias CSS v2 |
| `hse_panel.md` | Panel principal |
| `hse_themes_shadow_css.md` | Thèmes & shadow CSS |
| `hse_tokens_shadow_css.md` | Tokens CSS shadow |
| `init_py.md` | Module `__init__.py` |
| `manifest.md` | Manifest HA |
| `overview_api.md` | Vue d'ensemble API |
| `overview_view.md` | Vue d'ensemble des vues |
| `panel_loader.md` | Chargement du panel |
| `panel_shell.md` | Shell du panel |
| `panel_style.md` | Styles du panel |
| `persistent_catalogue.md` | Catalogue persistant |
| `placeholder_view.md` | Vue placeholder |
| `pricing_settings.md` | Paramètres de tarification |
| `scan_api.md` | API de scan |
| `scan_ui.md` | UI de scan |
| `table_js.md` | Tableaux JS |
| `tokens_css.md` | Tokens CSS |
| `unification_matrix.md` | Matrice d'unification |
| `unified_api.md` | API unifiée |

---

## Docs manquantes (à créer)

- `docs/shared_cost_engine.md`
- `docs/repairs.md`
- `docs/time_utils.md`
- `docs/costs_compare.md`
- `docs/diagnostic_check.md`
- `docs/enrich.md` (apply / cleanup / diagnose / preview)
- `docs/migration_export.md`
- `docs/catalogue_reference_total.md`
- `docs/frontend_manifest.md`
- `docs/translations.md`

---

## Convention de commit

Tout commit modifiant un fichier `.py` **doit** mentionner l'état de la doc :

```
feat(catalogue): ajout méthode bulk_update [doc: updated persistent_catalogue.md]
fix(scan_engine): correction timeout [doc: N/A - pas de changement d'API]
refactor(cost): extraction shared_cost_engine [doc: TODO - créer shared_cost_engine.md]
```

---

## Comment utiliser ce fichier avec une IA

Au début de chaque session, dis à l'IA :

> "Lis le fichier `CONTEXT.md` du repo `silentiss-jean/hse` et réponds à ma question : …"

Ou fournis directement le contenu de ce fichier en préambule de ta demande. L'IA aura alors le contexte complet du projet sans avoir à explorer le repo de zéro.

Pour vérifier les docs en retard : `python tools/check_doc_drift.py`
