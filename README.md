# Home Suivi Elec (HSE)

HSE est une intégration Home Assistant (custom integration) installable via HACS, qui ajoute un panel dans la sidebar et une API unifiée consommée par le panel. 

## Installation (HACS)
1. Ajouter ce dépôt dans HACS (Custom repository) en type **Integration**.
2. Installer / mettre à jour.
3. Redémarrer Home Assistant (recommandé après installation/màj d'intégration).
4. Aller dans **Settings → Devices & services → Add integration** et chercher **Home Suivi Elec**.

Après ajout de l'intégration, le panel **Home Suivi Elec** apparaît dans la sidebar.

## Vérifications rapides
### 1) Panel
Ouvrir le panel: tu dois voir la version et un “Ping OK”.

### 2) API
- Ping: `GET /api/hse/unified/ping`
- Frontend manifest: `GET /api/hse/unified/frontend_manifest`

## Bugs connus

### Écran noir après changement de bureau virtuel macOS (Mission Control)

**Symptôme** : après un glissement 3 doigts vers un autre bureau virtuel macOS puis retour sur
le bureau où Home Assistant est ouvert, le panel HSE reste noir indéfiniment.

**Workaround** : rafraîchir la page du navigateur (`Cmd + R`) — le panel recharge normalement
en quelques secondes.

**Cause** : macOS Mission Control ne déclenche aucun événement navigateur standard au retour.
La WebSocket HA se reconnecte avec de nouveaux IDs et l'arbre Lit de HA se retrouve
zombifié (`shadowRoot = null`). Le mécanisme de récupération automatique du loader ne
parvient pas à résoudre le cas systématiquement. Détail technique dans
[`docs/panel_loader.md`](custom_components/hse/docs/panel_loader.md).

## Dépannage
- Si “Add integration” ne montre pas HSE, vider le cache du navigateur (HA UI) puis réessayer.
- Logs: activer le debug pour `custom_components.hse`.

## Développement
- Code intégration sous `custom_components/hse/`.
- Le panel est un custom element qui reçoit `hass` automatiquement et utilise `hass.callApi()` (auth HA déjà gérée par le frontend).
