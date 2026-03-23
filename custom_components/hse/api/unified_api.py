"""HSE_DOC: custom_components/hse/docs/unified_api.md
HSE_MAINTENANCE: If you add/remove/rename views here, update the doc above.
"""

from __future__ import annotations

from .views.catalogue_get import CatalogueGetView
from .views.catalogue_item_triage import CatalogueItemTriageView
from .views.catalogue_reference_total import CatalogueReferenceTotalStatusView, CatalogueReferenceTotalView
from .views.catalogue_refresh import CatalogueRefreshView
from .views.catalogue_triage_bulk import CatalogueTriageBulkView
from .views.costs_compare import CostsCompareView
from .views.dashboard_overview import DashboardOverviewView
from .views.diagnostic_check import DiagnosticCheckView
from .views.enrich_apply import EnrichApplyView
from .views.enrich_cleanup import EnrichCleanupView
from .views.enrich_diagnose import EnrichDiagnoseView
from .views.enrich_preview import EnrichPreviewView
from .views.entities_scan import EntitiesScanView
from .views.frontend_manifest import FrontendManifestView
from .views.meta import MetaView
from .views.meta_sync_apply import MetaSyncApplyView
from .views.meta_sync_preview import MetaSyncPreviewView
from .views.migration_export import MigrationExportView
from .views.ping import PingView
from .views.settings_pricing import SettingsPricingView


def async_register_unified_api(hass) -> None:
    hass.http.register_view(PingView())
    hass.http.register_view(FrontendManifestView())
    hass.http.register_view(EntitiesScanView())
    hass.http.register_view(CatalogueGetView())
    hass.http.register_view(CatalogueRefreshView())
    hass.http.register_view(CatalogueItemTriageView())
    hass.http.register_view(CatalogueTriageBulkView())
    hass.http.register_view(CatalogueReferenceTotalView())
    hass.http.register_view(CatalogueReferenceTotalStatusView())
    hass.http.register_view(SettingsPricingView())

    hass.http.register_view(MetaView())
    hass.http.register_view(MetaSyncPreviewView())
    hass.http.register_view(MetaSyncApplyView())

    hass.http.register_view(EnrichPreviewView())
    hass.http.register_view(EnrichApplyView())
    hass.http.register_view(EnrichDiagnoseView())
    hass.http.register_view(EnrichCleanupView())
    hass.http.register_view(DiagnosticCheckView())
    hass.http.register_view(MigrationExportView())
    hass.http.register_view(DashboardOverviewView())
    hass.http.register_view(CostsCompareView())
