# Onglet Customisation — `custom.view.js`

Fichiers concernés :

- Vue (JS) : `custom_components/hse/web_static/panel/features/custom/custom.view.js` [cite:179]
- Entrypoint panel (chargement) : `custom_components/hse/web_static/panel/hse_panel.js` [cite:179]

Cet onglet est purement **frontend** : il n’appelle pas d’API backend, il modifie uniquement l’état UI (stocké dans `localStorage`) et des variables CSS / attributs du composant. [cite:179]

---

## Ce que propose l’onglet

### 1) Sélection de thème

- UI : un `<select>` listant les thèmes (ex: `dark`, `light`, `ocean`, `forest`, `sunset`, `minimal`, `neon`, `aurora`, `neuro`). [cite:179]
- Action : `set_theme(theme_key)` (émise via `on_action("set_theme", value)` côté vue). [cite:179]
- Effet : le panel applique le thème en posant l’attribut `data-theme` sur le webcomponent `hse-panel` (shadow host). [cite:179]
- Persistance : clé `localStorage` `hse_theme`. [cite:179]

### 2) Toggle “Fond dynamique”

- UI : bouton `Fond: ON/OFF`. [cite:179]
- Action : `toggle_dynamic_bg`. [cite:179]
- Effet : contrôle l’opacité de l’overlay de fond via la variable CSS `--hse-bg-dynamic-opacity` (quand OFF, override à `0`). [cite:179]
- Persistance : clé `localStorage` `hse_custom_dynamic_bg` (`"1"|"0"`). [cite:179]

### 3) Toggle “Glass”

- UI : bouton `Glass: ON/OFF`. [cite:179]
- Action : `toggle_glass`. [cite:179]
- Effet : applique/retire un `backdrop-filter` via la variable CSS `--hse-backdrop-filter` (quand ON: `blur(18px) saturate(160%)`). [cite:179]
- Persistance : clé `localStorage` `hse_custom_glass` (`"1"|"0"`). [cite:179]

---

## Contrat de state / actions

### State consommé par la vue

`render_customisation(container, state, on_action)` attend au minimum : [cite:179]

- `state.theme` (string)
- `state.dynamic_bg` (boolean)
- `state.glass` (boolean)

### Actions émises par la vue

La vue ne fait pas les effets elle-même : elle envoie des actions au panel : [cite:179]

- `on_action("set_theme", theme_key)`
- `on_action("toggle_dynamic_bg")`
- `on_action("toggle_glass")`

Le mapping actions -> effets est géré par `hse_panel.js` (dans `_render_custom()`). [cite:179]

---

## CSS utilisé (et comment c’est appelé)

Le CSS de cet onglet n’est pas spécifique : il réutilise les primitives partagées chargées dans le shadow DOM par `hse_panel.js`. [cite:179]

Chargement (ordre) : [cite:179]

1) `shared/styles/hse_tokens.shadow.css` — base tokens (fallback)
2) `shared/styles/hse_themes.shadow.css` — thèmes via `:host([data-theme=...])`
3) `shared/styles/hse_alias.v2.css` — alias compat
4) `shared/styles/tokens.css` — classes UI partagées utilisées par la vue

Classes utilisées par `custom.view.js` (exemples) : [cite:179]

- `hse_card` (carte)
- `hse_subtitle` (sous-titre)
- `hse_toolbar` (ligne d’actions)
- `hse_input` (ici appliqué sur un `<select>`)
- `hse_badges` (container des toggles)
- `hse_button` (boutons)

---

## Notes de maintenance

### Rendu incrémental (important)

La vue est conçue pour éviter de recréer le `<select>` à chaque rerender du panel (Home Assistant peut réassigner `hass` régulièrement, ce qui déclenche un `_render()`). [cite:179]

Règle : ne pas `clear(container)` systématiquement ; construire la structure une fois, puis mettre à jour `select.value` et les `textContent` des boutons. [cite:179]

### Checklist debug

Si l’onglet semble “ne pas marcher” : [cite:179]

1) Vérifier que `custom.view.js` est bien chargé par `hse_panel.js` (URL + cache-buster `ASSET_V`). [cite:179]
2) Vérifier que les classes CSS (ex: `hse_card`, `hse_button`) proviennent bien de `shared/styles/tokens.css` injecté dans le shadow DOM. [cite:179]
3) Vérifier les clés `localStorage` (`hse_theme`, `hse_custom_dynamic_bg`, `hse_custom_glass`). [cite:179]
