#!/usr/bin/env python3
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent  # tools/ -> racine repo
WEB = ROOT / "custom_components" / "hse" / "web_static"

files = {
    "hse_panel": WEB / "panel" / "hse_panel.js",
    "live_store": WEB / "panel" / "core" / "live.store.js",
    "live_service": WEB / "panel" / "core" / "live.service.js",
    "costs_tab": WEB / "panel" / "features" / "costs" / "costs.tab.js",
    "costs_view": WEB / "panel" / "features" / "costs" / "costs.view.js",
}

report = {
    "exists": {},
    "tab_elements": {},
    "boot_scripts": [],
    "live_service_start_overview": False,
    "costs_tab_custom_element": False,
    "costs_view_exports": [],
}

# 1) existence fichiers
for key, path in files.items():
    report["exists"][key] = path.is_file()

# 2) TAB_ELEMENTS + mapping
hp = files["hse_panel"].read_text(encoding="utf-8") if files["hse_panel"].is_file() else ""
m = re.search(r"const\s+TAB_ELEMENTS\s*=\s*\{([^}]+)\}", hp)
if m:
    body = m.group(1)
    for line in body.splitlines():
        line = line.strip().rstrip(",")
        if not line or ":" not in line:
            continue
        k, v = [x.strip() for x in line.split(":", 1)]
        k = k.strip("'\"")
        v = v.strip("'\"")
        report["tab_elements"][k] = v

# 3) scripts chargés au boot
boot_calls = re.findall(
    r"load_script_once\(`\$\{PANEL_BASE\}/([^`]+)`\)",
    hp
)
report["boot_scripts"] = sorted(set(boot_calls))

# 4) hse_live_service.start('overview', ...)
report["live_service_start_overview"] = bool(
    re.search(r"hse_live_service\.start\(\s*'overview'", hp)
)

# 5) custom element hse-tab-costs
ct = files["costs_tab"].read_text(encoding="utf-8") if files["costs_tab"].is_file() else ""
report["costs_tab_custom_element"] = "customElements.define('hse-tab-costs'" in ct

# 6) exports hse_costs_view
cv = files["costs_view"].read_text(encoding="utf-8") if files["costs_view"].is_file() else ""
m2 = re.search(r"window\.hse_costs_view\s*=\s*\{([^}]+)\}", cv)
if m2:
    body2 = m2.group(1)
    for line in body2.splitlines():
        line = line.strip().rstrip(",")
        if not line:
            continue
        fn = line.split(":", 1)[0].strip()
        report["costs_view_exports"].append(fn)

print(json.dumps(report, indent=2, ensure_ascii=False))