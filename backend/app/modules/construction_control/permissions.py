# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Construction-control permission definitions."""

from app.core.permissions import Role, permission_registry


def register_construction_control_permissions() -> None:
    """Register permissions for the construction-control module."""
    permission_registry.register_module_permissions(
        "construction_control",
        {
            # Acceptance criteria
            "cc.criterion.read": Role.VIEWER,
            "cc.criterion.create": Role.EDITOR,
            "cc.criterion.update": Role.EDITOR,
            "cc.criterion.delete": Role.MANAGER,
            # Inspections
            "cc.inspection.read": Role.VIEWER,
            "cc.inspection.create": Role.EDITOR,
            "cc.inspection.update": Role.EDITOR,
            "cc.inspection.delete": Role.MANAGER,
            # Recording a result can raise an NCR, so it sits at editor (not viewer).
            "cc.inspection.record_result": Role.EDITOR,
            # Material records (digital passport, EN 10204)
            "cc.material.read": Role.VIEWER,
            "cc.material.create": Role.EDITOR,
            "cc.material.update": Role.EDITOR,
            "cc.material.delete": Role.MANAGER,
            # Reviewing a material can raise an NCR, so it sits at editor (not viewer).
            "cc.material.review": Role.EDITOR,
            # Test results (ISO/IEC 17025 lab)
            "cc.test.read": Role.VIEWER,
            "cc.test.create": Role.EDITOR,
            "cc.test.update": Role.EDITOR,
            "cc.test.delete": Role.MANAGER,
            # Recording a test result can raise an NCR, so it sits at editor (not viewer).
            "cc.test.record_result": Role.EDITOR,
        },
    )
