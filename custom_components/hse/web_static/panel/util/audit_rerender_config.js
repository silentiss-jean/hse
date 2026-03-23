/**
 * audit_rerender_config.js
 * ========================
 * Script d'audit à coller dans la console du navigateur (DevTools) quand
 * la page HSE / onglet Configuration est active.
 *
 * ⚠️  Home Assistant utilise des shadow DOM imbriqués : hse-panel n'est pas
 *     accessible via document.querySelector(). Ce script traverse automatiquement
 *     tous les shadow roots pour le retrouver.
 *
 * Ce qu'il détecte :
 *   1. Chaque appel à _render() sur le panel → origine (stack) + timestamp
 *   2. Chaque appel à render_config() dans config.view.js → is_first / patch
 *   3. Chaque clear() du container → DANGER si la cost-card est ouverte
 *   4. Chaque rebuild complet de la cost-card → cause du collapse
 *   5. Polling référence (setInterval 4s) → si render est appelé depuis le finally
 *   6. Détection du cas "clear() pendant qu'un <details> est open"
 *   7. Résumé final après N secondes
 *
 * Usage :
 *   1. Ouvrir l'onglet Configuration dans HSE
 *   2. Ouvrir DevTools → Console
 *   3. Coller ce script et appuyer sur Entrée
 *   4. Interagir (ouvrir le bloc "Doublons détectés")
 *   5. Attendre ~10-15s pour voir les triggers
 *   6. Appeler hse_audit.report() manuellement ou attendre le rapport auto (30s)
 */
(function () {
  if (window.__hse_audit_running) {
    console.warn('[HSE-AUDIT] Déjà actif. Appelle hse_audit.stop() d\'abord.');
    return;
  }
  window.__hse_audit_running = true;

  const LOG = [];
  const t0 = Date.now();

  function ts() {
    return `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
  }

  function log(level, category, msg, extra) {
    const entry = { ts: ts(), level, category, msg, extra: extra || null };
    LOG.push(entry);
    const style = level === 'WARN' ? 'color:orange;font-weight:bold'
      : level === 'ERR'  ? 'color:red;font-weight:bold'
      : level === 'INFO' ? 'color:cyan'
      : 'color:#aaa';
    console.log(`%c[HSE-AUDIT ${entry.ts}] [${category}] ${msg}`, style, extra || '');
  }

  // -----------------------------------------------------------------------
  // 0. Traversée des shadow DOM imbriqués (HA wraps everything in shadow roots)
  // -----------------------------------------------------------------------
  function _find_in_shadow(root, selector) {
    // BFS sur tous les shadow roots accessibles depuis `root`
    const queue = [root];
    while (queue.length) {
      const node = queue.shift();
      // Chercher dans ce nœud
      const found = (node.querySelectorAll ? node.querySelectorAll(selector) : []);
      for (const el of found) {
        return el; // premier trouvé
      }
      // Parcourir les enfants et leurs shadow roots
      const children = node.querySelectorAll ? Array.from(node.querySelectorAll('*')) : [];
      for (const child of children) {
        if (child.shadowRoot) queue.push(child.shadowRoot);
      }
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // 1. Trouver le panel element (traverse shadow DOM HA)
  // -----------------------------------------------------------------------
  let panel = document.querySelector('hse-panel');
  if (!panel) {
    // HA monte hse-panel dans un shadow root profond
    log('INFO', 'SETUP', 'hse-panel non trouvé au niveau document — traverse les shadow roots HA...');
    panel = _find_in_shadow(document, 'hse-panel');
  }

  // Tentative via window.__hse_panel_loaded (marqueur posé par hse_panel.js)
  if (!panel && window.__hse_panel_loaded) {
    // Le panel est chargé mais pas trouvé dans le DOM standard → chercher différemment
    log('INFO', 'SETUP', '__hse_panel_loaded détecté — recherche élargie...');
    // Chercher dans tous les custom elements enregistrés
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) {
        const found = el.shadowRoot.querySelector('hse-panel');
        if (found) { panel = found; break; }
        // Un niveau de plus
        const deep = el.shadowRoot.querySelectorAll('*');
        for (const d of deep) {
          if (d.shadowRoot) {
            const f2 = d.shadowRoot.querySelector('hse-panel');
            if (f2) { panel = f2; break; }
          }
        }
        if (panel) break;
      }
    }
  }

  if (!panel) {
    log('ERR', 'SETUP',
      'hse-panel introuvable après traversée complète des shadow roots.\n' +
      'Vérifications:\n' +
      '  1. Es-tu bien sur la page HSE (URL contient /hse) ?\n' +
      '  2. L\'onglet Configuration est-il visible à l\'écran ?\n' +
      '  3. Recharge la page HSE complètement puis relance ce script.\n' +
      'Debug: window.__hse_panel_loaded = ' + JSON.stringify(window.__hse_panel_loaded)
    );
    window.__hse_audit_running = false;
    return;
  }
  log('INFO', 'SETUP', 'hse-panel trouvé ✅', { tag: panel.tagName, active_tab: panel._active_tab });

  const shadow = panel.shadowRoot;
  if (!shadow) {
    log('ERR', 'SETUP', 'shadowRoot introuvable sur hse-panel.');
    window.__hse_audit_running = false;
    return;
  }

  // -----------------------------------------------------------------------
  // 2. Monkey-patch _render() sur le panel
  // -----------------------------------------------------------------------
  const orig_render = panel._render?.bind(panel);
  if (!orig_render) {
    log('ERR', 'SETUP', '_render() introuvable sur le panel.');
  } else {
    panel._render = function audited_render() {
      const stack = (new Error()).stack || '';
      const lines = stack.split('\n').slice(2, 6).map(l => l.trim()).join(' | ');

      const content = shadow.querySelector('#root');
      const costCard = content?.querySelector('[data-hse-section="cost"]');
      const openDetails = costCard ? Array.from(costCard.querySelectorAll('details[open]')) : [];

      const dangerLevel = openDetails.length > 0 ? 'WARN' : 'DEBUG';
      log(dangerLevel, '_RENDER',
        openDetails.length > 0
          ? `⚠️  _render() appelé avec ${openDetails.length} <details> ouverts dans cost-card → COLLAPSE IMMINENT`
          : `_render() appelé (pas de <details> ouverts dans cost-card)`,
        { caller: lines, active_tab: panel._active_tab, openDetails: openDetails.map(d => d.className) }
      );

      return orig_render.apply(this, arguments);
    };
    log('INFO', 'SETUP', '_render() patché');
  }

  // -----------------------------------------------------------------------
  // 3. Monkey-patch _render_if_not_interacting()
  // -----------------------------------------------------------------------
  const orig_rini = panel._render_if_not_interacting?.bind(panel);
  if (orig_rini) {
    panel._render_if_not_interacting = function audited_rini() {
      const stack = (new Error()).stack || '';
      const lines = stack.split('\n').slice(2, 5).map(l => l.trim()).join(' | ');
      const skipped = panel._user_interacting;
      log(skipped ? 'DEBUG' : 'INFO', 'RINI',
        skipped
          ? `_render_if_not_interacting() → ignoré (user_interacting=true)`
          : `_render_if_not_interacting() → PASS → va appeler _render()`,
        { caller: lines }
      );
      return orig_rini.apply(this, arguments);
    };
    log('INFO', 'SETUP', '_render_if_not_interacting() patché');
  }

  // -----------------------------------------------------------------------
  // 4. Monkey-patch render_config() dans config.view.js
  // -----------------------------------------------------------------------
  if (window.hse_config_view?.render_config) {
    const orig_rc = window.hse_config_view.render_config;
    window.hse_config_view.render_config = function audited_render_config(container, model, on_action) {
      const is_first = !container.hasAttribute('data-hse-config-built');
      const openDetails = Array.from(container.querySelectorAll('details[open]'));
      const kind = is_first ? 'BUILD (premier rendu)' : 'PATCH (patch partiel)';

      if (!is_first && openDetails.length > 0) {
        log('WARN', 'RENDER_CONFIG',
          `⚠️  render_config() PATCH avec ${openDetails.length} <details> ouverts → la cost-card sera reconstruite → COLLAPSE`,
          { openDetails: openDetails.map(d => d.className || d.tagName) }
        );
      } else {
        log('INFO', 'RENDER_CONFIG', `render_config() → ${kind}`, { is_first });
      }

      return orig_rc.apply(this, arguments);
    };
    log('INFO', 'SETUP', 'hse_config_view.render_config() patché');
  } else {
    log('WARN', 'SETUP', 'hse_config_view.render_config introuvable. Charge la page config d\'abord.');
  }

  // -----------------------------------------------------------------------
  // 5. Surveiller les setInterval actifs
  // -----------------------------------------------------------------------
  const INTERVALS = new Map();
  const orig_setInterval = window.setInterval;
  window.setInterval = function audited_setInterval(fn, delay, ...args) {
    const id = orig_setInterval.call(window, function () {
      if (panel._active_tab === 'config' && delay <= 5000) {
        log('DEBUG', `INTERVAL(${delay}ms)`, `tick id=${id}`);
      }
      return fn.apply(this, arguments);
    }, delay, ...args);
    const stack = (new Error()).stack || '';
    const lines = stack.split('\n').slice(2, 4).map(l => l.trim()).join(' | ');
    INTERVALS.set(id, { delay, created: ts(), stack: lines });
    if (delay <= 5000) {
      log('INFO', 'INTERVAL', `Nouveau setInterval créé — delay=${delay}ms id=${id}`, { stack: lines });
    }
    return id;
  };

  const orig_clearInterval = window.clearInterval;
  window.clearInterval = function audited_clearInterval(id) {
    if (INTERVALS.has(id)) {
      log('DEBUG', 'INTERVAL', `clearInterval(${id})`);
      INTERVALS.delete(id);
    }
    return orig_clearInterval.call(window, id);
  };
  log('INFO', 'SETUP', 'setInterval/clearInterval patchés');

  // -----------------------------------------------------------------------
  // 6. MutationObserver : détecter quand la cost-card est vidée
  // -----------------------------------------------------------------------
  const root_el = shadow.querySelector('#root');
  if (root_el) {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        for (const removed of m.removedNodes) {
          if (!(removed instanceof Element)) continue;
          if (removed.dataset?.hseSection === 'cost') {
            const openInRemoved = Array.from(removed.querySelectorAll('details[open]'));
            if (openInRemoved.length > 0) {
              log('ERR', 'MUTATION',
                `🔴 cost-card RETIRÉE DU DOM avec ${openInRemoved.length} <details> encore ouverts → CAUSE DU COLLAPSE`,
                { openDetails: openInRemoved.map(d => d.querySelector('.hse_fold_title')?.textContent || d.className) }
              );
            } else {
              log('DEBUG', 'MUTATION', 'cost-card retirée du DOM (aucun <details> ouvert, pas de collapse visible)');
            }
          }
        }
      }
    });
    mo.observe(root_el, { childList: true, subtree: true });
    log('INFO', 'SETUP', 'MutationObserver actif sur #root');
  }

  // -----------------------------------------------------------------------
  // 7. Rapport
  // -----------------------------------------------------------------------
  const report = () => {
    const warns = LOG.filter(l => l.level === 'WARN');
    const errs  = LOG.filter(l => l.level === 'ERR');
    const renders = LOG.filter(l => l.category === '_RENDER');
    const collapses = LOG.filter(l => l.msg?.includes('COLLAPSE'));

    console.group('%c[HSE-AUDIT] ===== RAPPORT =====', 'color:yellow;font-size:14px;font-weight:bold');
    console.log(`Total events    : ${LOG.length}`);
    console.log(`_render() calls : ${renders.length}`);
    console.log(`WARN            : ${warns.length}`);
    console.log(`ERR             : ${errs.length}`);
    console.log(`Collapse events : ${collapses.length}`);
    console.log('');

    if (collapses.length) {
      console.group('%c🔴 COLLAPSE EVENTS (causes du repli des <details>)', 'color:red;font-weight:bold');
      for (const e of collapses) {
        console.log(`  ${e.ts} [${e.category}] ${e.msg}`, e.extra || '');
      }
      console.groupEnd();
    } else {
      console.log('%c✅ Aucun collapse détecté pendant la session.', 'color:green');
    }

    if (renders.length) {
      console.group('_render() calls détail');
      for (const r of renders) {
        const flag = r.level === 'WARN' ? '⚠️ ' : '  ';
        console.log(`${flag}${r.ts} ${r.msg}`);
        if (r.extra?.caller) console.log(`     caller: ${r.extra.caller}`);
      }
      console.groupEnd();
    }

    if (warns.length || errs.length) {
      console.group('WARN + ERR');
      for (const e of [...errs, ...warns]) {
        console.log(`  ${e.ts} [${e.level}] [${e.category}] ${e.msg}`, e.extra || '');
      }
      console.groupEnd();
    }

    console.log('\nAccès au log brut: window.hse_audit.log');
    console.groupEnd();
  };

  const stop = () => {
    window.setInterval = orig_setInterval;
    window.clearInterval = orig_clearInterval;
    if (orig_render) panel._render = orig_render;
    if (orig_rini)   panel._render_if_not_interacting = orig_rini;
    window.__hse_audit_running = false;
    log('INFO', 'SETUP', 'Audit arrêté.');
    report();
  };

  window.hse_audit = { log: LOG, report, stop };

  log('INFO', 'SETUP', '✅ Audit HSE config actif. Interagis avec la page pendant ~15-30s puis appelle hse_audit.report() ou attends 30s.');

  orig_setInterval.call(window, () => {
    if (window.__hse_audit_running) {
      log('INFO', 'SETUP', 'Rapport automatique (30s)');
      report();
    }
  }, 30000);
})();
