# Panel core loader — `loader.js`

Target file:

- `custom_components/hse/web_static/panel/core/loader.js`

AI-first: exported functions and rules.
Human layer: troubleshooting + extension checklist.

---

## Purpose

Provide two small primitives used by the panel to load assets:

- `load_script_once(url)` to dynamically load JS without duplicates.
- `load_css_text(url)` to fetch CSS as text (for injection into shadow DOM).

This module exports into the global namespace:

- `window.hse_loader`

It also embeds a **panel health watchdog** (polling toutes les 2s) qui tente
de récupérer automatiquement le panel après certains cas de zombie Lit
(voir section Bug connu ci-dessous).

---

## Public API

### `window.hse_loader.load_script_once(url) -> Promise<void>`

Rules:

1) Deduplication is based on exact URL string; already loaded URLs are stored in a module-level `Set`.
2) Script element is appended to `document.head` with `async=true`.
3) Success is resolved on `script.onload`.
4) Failure rejects with `Error("script_load_failed: <url>")`.

Implications:

- Cache-busting query strings (e.g. `?v=...`) create distinct URLs and will load again.

### `window.hse_loader.load_css_text(url) -> Promise<string>`

Rules:

1) Uses `fetch(url, { cache: "no-store" })`.
2) If `resp.ok` is false, throws `Error("css_load_failed: <url> (<status>)")`.
3) Returns `resp.text()`.

Implications:

- CSS is expected to be injected by the caller (typically into `<style>` within shadow DOM).

---

## Usage scenarios

### Scenario A — Normal boot

- Panel calls `load_script_once()` for shared UI helpers then feature views.
- Panel calls `load_css_text()` for shadow styles, concatenates them into a `<style>` block.

### Scenario B — Asset load error

- A 404 on static hosting will show up as `css_load_failed` or `script_load_failed`.
- The panel boot code should catch and render an error view.

---

## Panel health watchdog

Le loader enregistre deux mécanismes de surveillance :

- `setInterval(_check_panel_health, 2000)` — poll toutes les 2s
- `document.addEventListener('visibilitychange', ...)` — déclenché au retour de focus

### Cas 1 — hass manquant (`!panel.hass`)

Si `ha-panel-custom` existe et a un shadowRoot valide mais `hass` est null,
le watchdog réinjecte `freshHass` directement. Ce cas est rare et se résout
généralement sans intervention.

### Cas 2 — shadowRoot null (zombie Lit)

Si `ha-panel-custom.shadowRoot === null`, le watchdog appelle
`ppr.requestUpdate()` sur `partial-panel-resolver` pour forcer Lit à
re-rendre l'arbre, puis poll `conn.connected` toutes les 200ms avant
d'injecter `hass` sur la nouvelle instance.

Ce mécanisme ne résout pas systématiquement le bug macOS bureaux virtuels
(voir section suivante).

---

## Bug connu — Écran noir après changement de bureau virtuel macOS (Mission Control)

### Symptôme

Après un glissement 3 doigts vers un autre bureau virtuel macOS puis retour
sur le bureau où Home Assistant est ouvert, le panel HSE reste **noir
indéfiniment**.

En console on observe :

```
[HSE] panel loaded (2026-03-27_fix_hass_reinject)
[HSE] hse-panel (Lit) registered (...)
[HSE] store reinit: modules rebranches sur nouveau hse_store
[HSE] overview tick: WS not connected, retry in 2s
Uncaught (in promise) > {code: 'not_found', message: 'Subscription not found.'}
```

### Cause

MacOS Mission Control ne déclenche aucun événement navigateur standard
(`visibilitychange` et `window.focus` sont non fiables dans ce contexte).
Au retour, la WebSocket HA se reconnecte avec de nouveaux subscription IDs.
L'arbre Lit de HA (`partial-panel-resolver` → `ha-panel-custom`) se retrouve
zombifié (`shadowRoot = null`, `connectedCallback` jamais rappelé).

Même après recréation de `ha-panel-custom` via `ppr.requestUpdate()`,
le `hass` injecté a `conn.connected = false` au moment de l'injection,
ce qui empêche le tick overview de s'exécuter. Le panel reste noir.

### Workaround

**Rafraîchir la page du navigateur** (`Cmd + R` ou `F5`) résout
immédiatement le problème. Le panel recharge normalement en quelques
secondes.

### Statut

- Bug ouvert, non résolu automatiquement malgré plusieurs tentatives de fix
  côté loader (navigate, hass re-inject, requestUpdate + poll conn.connected).
- Priorité basse : workaround simple (rechargement page), impact limité
  aux utilisateurs macOS avec Mission Control.
- Tentatives documentées dans l'historique git (commits `fix_hass_watchdog`,
  `fix_hass_reinject`, et suivants sur `loader.js`).

---

## Human checklist

Si le panel est blanc/noir après un changement de bureau virtuel macOS :

1) **Rafraîchir la page** (`Cmd + R`) — workaround immédiat et fiable.
2) Si le problème survient au chargement normal (sans changement de bureau),
   ouvrir les DevTools console et chercher `script_load_failed`.
3) Vérifier l'onglet Network : les URLs statiques doivent retourner 200.
4) Vérifier que le cache-buster `v=` correspond à la version backend.
