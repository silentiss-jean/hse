# Configuration UI

## Référence totale

- `set_reference_total(hass, entity_id)` poste le choix utilisateur vers `POST hse/unified/catalogue/reference_total`.
- `get_reference_total_status(hass, entity_id)` interroge `GET hse/unified/catalogue/reference_total/status`.
- Le front peut afficher un snapshot déjà présent dans `item.workflow.reference_enrichment` avant la première réponse du endpoint de statut.

## Affichage

- Le panneau Configuration affiche la référence actuelle, le sélecteur, puis un bloc de progression du workflow.
- Le bloc de progression peut afficher `status`, `progress_phase`, `progress_label`, `attempt`, `attempts_total`, `retry_scheduled`, `done`, `last_error` et `mapping`.
- Les couleurs doivent rester basées sur les variables CSS HSE / Home Assistant existantes.
