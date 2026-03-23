# Panel entrypoint web component — `hse_panel.js`

Target file:

- `custom_components/hse/web_static/panel/hse_panel.js`

AI-first: boot sequence, state model, action dispatch.
Human layer: scenarios and debugging checklist.

**Version actuelle : `build_signature = "2026-03-20_refonte_store_phase9"`**

---

## Purpose

Defines the custom element `<hse-panel>` (shadow DOM) used by Home Assistant to render the integration panel.

Responsibilities:

- Boot: load shared JS + feature modules + shadow CSS in strict order.
- Render: create shell and mount feature views.
- State: proxy vers les state bridges (hse_store phase 8/9), persistance `localStorage`.
- Actions: dispatch user actions depuis les feature views.

---

## Public contract

- Custom element name: `hse-panel`.
- Expects Home Assistant to set `element.hass = hass`.
- Uses global helpers loaded at runtime:
  - `window.hse_loader`, `window.hse_dom`, `window.hse_table`, `window.hse_shell`
  - `window.hse_store` (store central — phase 8)
  - state bridges: `window.hse_diag_state`, `window.hse_config_state`, `window.hse_overview_state`
  - feature modules: `window.hse_overview_api/state/view`, `window.hse_scan_api/view`,
    `window.hse_custom_view`, `window.hse_config_api/view`, `window.hse_diag_api/view`,
    `window.hse_migration_api/view`, `window.hse_cards_api/view/controller`,
    `window.hse_costs_view`, `window.hse_enrich_api`

---

## Boot sequence (ordre réel)

Entry: `connectedCallback()`

1. Early return si déjà initialisé (`this._root`).
2. Log build signature + `window.__hse_panel_loaded = build_signature`.
3. Restauration préférences UI depuis `localStorage` :
   - `hse_theme`, `hse_custom_dynamic_bg`, `hse_custom_glass`
   - `hse_active_tab`
   - scan UI : `hse_scan_groups_open`, `hse_scan_open_all`
   - _diag_state et _config_state sont restaurés par leurs propres state bridges._
4. `this.attachShadow({ mode: "open" })`.
5. Bind listeners interaction utilisateur (mousedown, focusin, keydown, touchstart).
6. Appel async `_boot()`.

Boot: `_boot()` — ordre strict de chargement

```
dom.js → table.js
→ hse.store.js                        (store central — doit être en premier)
→ diag.state.js                       (state bridge diagnostic)
→ config.state.js                     (state bridge config)
→ shell.js
→ overview.api.js
→ overview.state.js                   (après store, avant overview.view.js)
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

Cache-busting : `ASSET_V` (`0.1.37`) est appendé en `?v=<ASSET_V>`. Doit correspondre à `PANEL_JS_URL` dans `const.py`.

---

## Modèle de state (phase 8/9)

### Helpers state bridges — accès direct

```js
_dg(k)     // diag  : window.hse_diag_state?.get(k)
_ds(k, v)  // diag  : window.hse_diag_state?.set(k, v)
_cg(k)     // config: window.hse_config_state?.get(k)
_cs(k, v)  // config: window.hse_config_state?.set(k, v)
```

### Proxy locaux (fallback avant chargement du bridge)

- `this._diag_state` — Proxy vers `window.hse_diag_state` (get/set).
- `this._config_state` — Proxy vers `window.hse_config_state` (get/set).

### overview.state — accès direct intentionnel (pas de proxy)

`window.hse_overview_state` expose une API métier étendue au-delà du simple get/set :
- `begin_fetch()` — signale un fetch en cours.
- `end_fetch(data, hass, container)` — stocke data + déclenche `patch_live` via subscriber.
- `register_container(el, hass)` — enregistre le container pour `patch_live`.
- `update_hass(hass)` — met à jour la référence hass dans le state.
- `get(k)` / `set(k, v)` — accès store préfixé `overview.*`.

> **Exception de pattern intentionnelle** : contrairement à `_diag_state` et `_config_state`,
> `_overview_state` n'a pas de proxy local dans `hse_panel.js`. Les méthodes métier
> (`begin_fetch`, `end_fetch`, `register_container`, `update_hass`) sont appelées directement
> via `window.hse_overview_state?.method?.()`. Ce choix est délibéré car l'API overview
> ne se réduit pas à get/set.

### _org_state — bridge compatibilité vers hse_store

Getters/setters directs sur `window.hse_store` pour les clés `org.*` :
`loading`, `saving`, `dirty`, `error`, `message`, `meta_store`, `meta_draft`.

---

## Rendering model

Main renderer: `_render()`

Flow :

1. Crée le shell une seule fois via `hse_shell.create_shell()`, refs dans `this._ui`.
2. Met à jour le label header avec le nom utilisateur.
3. `_ensure_valid_tab()` — valide l'onglet actif.
4. `_render_nav_tabs()` — construit la barre de navigation.
5. Nettoyage du contenu (sauf config/cards déjà construits — guard `data-hse-*-built`).
6. Si `hass` manquant : affiche "En attente de hass…".
7. Arrête les timers hors-contexte (overview si pas overview/costs, reference_status si pas config).
8. Switch `this._active_tab` :
   - `overview` → `_render_overview()`
   - `costs` → `_render_costs()`
   - `diagnostic` → `_render_diagnostic()`
   - `scan` → `_render_scan()`
   - `migration` → `_render_migration()`
   - `config` → `_render_config()`
   - `custom` → `_render_custom()`
   - `cards` → `_render_cards()`

### Protections scroll-jack et interactions utilisateur

- `_user_interacting` : flag levé sur mousedown/focusin/keydown/touchstart pendant 2s.
- `_render_if_not_interacting()` : skip si interaction en cours.
- `_render_for_active_tab(tab_id)` : skip si tab inactive ou si org.saving.
- TABS_STABLE : `cards, custom, config, costs, diagnostic, scan, migration` — le setter `hass` ne re-render pas ces onglets.

---

## Overview autorefresh (phase 9)

- Timer `setInterval(30s)` dans `_ensure_overview_autorefresh()`.
- Tick : `begin_fetch()` → `fn(hass)` → `end_fetch(data, hass, container)`.
- `end_fetch` écrit dans `hse_store` → subscriber `overview.data` → `patch_live()` en-place **sans** `clear()`.
- Re-render `_render_if_not_interacting()` uniquement si le container n'est pas encore construit (`data-hse-overview-built`).

## Reference status polling (config)

- Timer `setInterval(4s)` dans `_ensure_reference_status_polling()`.
- `_fetch_reference_status(for_entity_id)` : boucle de retry si `target_entity_id` change en cours de fetch.
- Résultat stocké via `_cs('reference_status', ...)`.
- Re-render partiel via `render_config()` si container déjà construit, sinon `_render()`.

---

## State persistence localStorage

| Clé | Type | Usage |
|-----|------|-------|
| `hse_theme` | string | Thème actif |
| `hse_custom_dynamic_bg` | `"0"/"1"` | Fond dynamique |
| `hse_custom_glass` | `"0"/"1"` | Effet glass |
| `hse_active_tab` | string | Onglet actif |
| `hse_scan_groups_open` | JSON | Groupes ouverts onglet scan |
| `hse_scan_open_all` | `"0"/"1"` | Tout déplier onglet scan |

Les clés `diag.*` et `config.*` sont gérées par `diag.state.js` et `config.state.js`.
Les clés `overview.*` sont gérées par `overview.state.js`.

---

## Usage scenarios

### Scenario A — Boot error

Symptoms: Panel shows "Boot error".

Likely causes:
- Static hosting 404 sur un fichier JS/CSS.
- Mauvais ordre de chargement des modules.
- `ASSET_V` ne correspond pas à `PANEL_JS_URL` dans `const.py`.

Fix: Console devtools → chercher `script_load_failed` ou `css_load_failed`.

### Scenario B — Tab renamed in `shell.js`

Symptoms: Clic sur un onglet → placeholder vide.

Fix: Aligner les `id` dans `shell.js get_nav_items()` avec les `case` du switch `_render()`.

### Scenario C — Cache/version mismatch

Symptoms: Ancien JS servi après mise à jour.

Fix: Bumper `ASSET_V` dans `hse_panel.js` ET `PANEL_JS_URL` dans `const.py`.

### Scenario D — overview scroll-jack

Symptoms: Page overview remonte en haut toutes les 30s.

Fix: Vérifier que `end_fetch` appelle bien `patch_live` et non `render_overview` → s'assurer que `data-hse-overview-built` est posé après le premier render.

---

## Human checklist

1. Console devtools : chercher `script_load_failed` / `css_load_failed` / `[HSE] boot error`.
2. Vérifier `ASSET_V` === version dans `PANEL_JS_URL` (`const.py`).
3. Vérifier que tous les `window.hse_*` globaux sont définis après boot.
4. Inspecter `localStorage` si l'état UI est incohérent.
5. En cas de bug state : vérifier `window.hse_store`, `window.hse_diag_state`, `window.hse_config_state`, `window.hse_overview_state`.
