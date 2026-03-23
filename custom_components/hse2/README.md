# Home Suivi Elec (HSE)

HSE est une intégration Home Assistant (custom integration) installable via HACS, qui ajoute un panel dans la sidebar et une API unifiée consommée par le panel. 

## Installation (HACS)
1. Ajouter ce dépôt dans HACS (Custom repository) en type **Integration**.
2. Installer / mettre à jour.
3. Redémarrer Home Assistant (recommandé après installation/màj d’intégration).
4. Aller dans **Settings → Devices & services → Add integration** et chercher **Home Suivi Elec**. [web:112]

Après ajout de l’intégration, le panel **Home Suivi Elec** apparaît dans la sidebar.

## Vérifications rapides
### 1) Panel
Ouvrir le panel: tu dois voir la version et un “Ping OK”.

### 2) API
- Ping: `GET /api/hse/unified/ping`
- Frontend manifest: `GET /api/hse/unified/frontend_manifest`

## Dépannage
- Si “Add integration” ne montre pas HSE, vider le cache du navigateur (HA UI) puis réessayer. [web:112]
- Logs: activer le debug pour `custom_components.hse`.

## Développement
- Code intégration sous `custom_components/hse/`.
- Le panel est un custom element qui reçoit `hass` automatiquement et utilise `hass.callApi()` (auth HA déjà gérée par le frontend). [page:1]

