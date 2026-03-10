"""Unit tests for enrichment helpers.

Focused on base slug derivation since that's a critical UX contract.
"""

import pytest

from custom_components.hse.api.views.enrich_preview import _derive_base_slug


@pytest.mark.parametrize(
    ("entity_id", "expected"),
    [
        ("sensor.chambre_alex_pc_consommation_actuelle", "chambre_alex_pc"),
        ("sensor.clim_appart_2_puissance", "clim_appart_2"),
        ("sensor.foo_power", "foo"),
        ("sensor.bar_w", "bar"),
    ],
)
def test_derive_base_slug_ok(entity_id, expected):
    assert _derive_base_slug(entity_id) == expected


@pytest.mark.parametrize(
    "entity_id",
    [
        "",
        "sensor.",
        "light.kitchen",
        "sensor",
        None,
    ],
)
def test_derive_base_slug_invalid(entity_id):
    with pytest.raises(Exception):
        _derive_base_slug(entity_id)  # type: ignore[arg-type]
