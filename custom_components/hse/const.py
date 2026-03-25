DOMAIN = "hse"

API_PREFIX = "/api/hse/unified"
STATIC_URL = "/api/hse/static"

PANEL_URL_PATH = "hse"
PANEL_TITLE = "Home Suivi Elec v2"
PANEL_ICON = "mdi:flash"

PANEL_JS_URL = f"{STATIC_URL}/panel/hse_panel.js?v=0.1.43"
PANEL_ELEMENT_NAME = "hse-panel"

# Catalogue refresh default interval
CATALOGUE_REFRESH_INTERVAL_S = 600  # 10 minutes

# Consider an entity degraded if it stays unavailable/unknown this long.
CATALOGUE_OFFLINE_GRACE_S = 900  # 15 minutes

# Meta (rooms/types) continuous sync interval
META_SYNC_INTERVAL_S = 600  # 10 minutes
