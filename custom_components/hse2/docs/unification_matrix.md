# Matrice d'unification HSE

> Synthèse opérationnelle dérivée de `architecture_current_state.md` pour piloter la suite sans repartir d’une feuille blanche.

## Lecture rapide

L’intégration n’est plus dans un état “tout est spécifique par onglet”. Le socle commun existe déjà, mais son niveau de maturité varie selon les domaines.

## État des blocs

| Bloc | Niveau actuel | Ce qui est déjà en place | Ce qui manque encore |
|---|---|---|---|
| Bootstrap / runtime | Bien mutualisé | API unifiée, panel unique, stores chargés au setup, tâches périodiques | Peu de choses structurelles ; surtout clarifier la doc |
| Catalogue | Bien mutualisé | Scan, identité stable des items, santé, escalade, triage persistant, règles `reference_total` | Vérifier que toutes les vues consomment ce modèle plutôt que des reconstructions locales |
| Meta | Bien mutualisé | Snapshot HA, pending diff, application auto/all, respect des modes manuels | Mieux relier cette couche à l’UI et aux autres vues métier |
| Pricing | Bien mutualisé | Stockage central dans `catalogue.settings.pricing`, validation, defaults | Réutilisation plus systématique par les vues aval |
| API unifiée | Bien mutualisé | Registre central des vues par familles métier | Normaliser davantage les contrats entre familles |
| Enrichissement helpers | Bien mutualisé côté création | Convention stable `base -> kwh_total/day/week/month/year`, preview/apply/diagnose/cleanup, création réelle via config flows | Exposer un meilleur suivi d’état frontend quand la création dure ou nécessite remédiation |
| Référence totale | Mutualisé côté UI + statut | Endpoint de statut, bloc de progression dans Configuration, snapshot workflow persistant, polling frontend | Factoriser ce contrat de statut pour d’autres workflows utiles |
| Migration / export | Partiellement mutualisé | Exports YAML cohérents avec la convention HSE, réutilisation de la sélection pricing | Partie coût encore limitée, contrat fixe seulement |
| Overview / dashboard | Contrat avancé mais incomplet | Endpoint unique, structure riche, logique live fonctionnelle, delta référence | Calculs de coûts et tableaux encore vides ; moteur métier manquant |
| Frontend panel | Partiellement mutualisé | Panel unique, familles de features, consommation d’une API unifiée | Continuer à mutualiser les patterns UI de workflow et de remédiation |

## Ce qui est déjà solide

- L’intégration possède un **noyau commun** crédible.
- Le stockage persistant métier existe déjà.
- La convention d’enrichissement des entités est identifiable et exploitable.
- Le pricing est centralisé.
- Le flux `reference_total` dispose désormais d’un vrai suivi d’état UI.

## Ce qui reste incomplet

- Le calcul métier énergie/coût n’est pas encore entièrement mutualisé.
- L’overview reste le cas le plus visible : structure prête, moteur incomplet.
- Le suivi d’état de workflow n’est pas encore un contrat générique partagé entre `reference_total` et enrichissement helpers.
- Certaines conventions sont présentes dans le code mais pas encore assez explicites dans la doc de maintenance.

## Route recommandée

1. Consolider une source unique de calcul énergie/coût utilisable par l’overview et, si possible, par l’export.
2. Ne pas dupliquer le flux `reference_total` capteur par capteur ; factoriser un contrat générique de statut de workflow.
3. Réutiliser ce contrat pour les workflows où l’utilisateur a vraiment besoin d’un suivi d’état, notamment la création/remédiation helpers.
4. Continuer à éviter les logiques spécifiques par onglet.
5. Faire ensuite une passe de documentation plus fine fichier par fichier.

## Décision proposée pour la suite

La meilleure suite est de faire émerger deux couches communes :

- une couche métier **énergie -> coût** ;
- une couche UI/API **workflow status** réutilisable pour `reference_total` et, si pertinent, pour l’enrichissement helpers.
