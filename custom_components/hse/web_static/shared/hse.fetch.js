/* shared/hse.fetch.js
 * Helper HTTP pour remplacer hass.callApi() partout dans HSE.
 *
 * hass.callApi() route via la WebSocket HA. Au retour d'un bureau virtuel,
 * la WS peut s'être reconnectée avec de nouveaux subscription IDs — les
 * anciens sont invalides et produisent 'Subscription not found' comme
 * promesse rejetée non-catchée.
 *
 * hse_fetch() utilise fetch() HTTP pur avec le token de session HA
 * (hass.auth.data.access_token). Le token est géré automatiquement par HA,
 * renouvelé à l'expiration, sans configuration utilisateur.
 *
 * Usage :
 *   const data = await hse_fetch(hass, 'GET', 'hse/unified/dashboard');
 *   const data = await hse_fetch(hass, 'POST', 'hse/unified/catalogue/refresh', {});
 *
 * Comportement :
 *   - Méthode GET  : body ignoré
 *   - Méthode POST : body sérialisé en JSON
 *   - Réponse non-ok : throw une Error avec status + texte
 *   - Réponse vide (204) : retourne null
 */
(function () {
  async function hse_fetch(hass, method, path, body) {
    const upper = (method || 'GET').toUpperCase();
    const token = hass?.auth?.data?.access_token;

    if (!token) throw new Error('hse_fetch: hass.auth.data.access_token indisponible');

    const url = '/api/' + path;
    const opts = {
      method: upper,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
    };

    if (upper !== 'GET' && upper !== 'HEAD' && body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(url, opts);

    if (!resp.ok) {
      let detail = '';
      try { detail = await resp.text(); } catch (_) {}
      throw new Error(`hse_fetch ${upper} ${url} → ${resp.status} ${resp.statusText}${detail ? ': ' + detail : ''}`);
    }

    // 204 No Content
    if (resp.status === 204) return null;

    return resp.json();
  }

  window.hse_fetch = hse_fetch;
})();
