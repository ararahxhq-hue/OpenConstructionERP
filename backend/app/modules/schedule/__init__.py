"""‌⁠‍4D Schedule module.

Provides construction scheduling with WBS hierarchy, BOQ position linking,
Gantt chart data, and work order management.
"""


async def on_startup() -> None:
    """‌⁠‍Module startup hook - register permissions + the queryable entity."""
    from app.modules.saved_views.registry import entity_registry
    from app.modules.schedule.permissions import register_schedule_permissions
    from app.modules.schedule.saved_view_entity import ENTITY_TYPE as ACTIVITY_ENTITY_TYPE
    from app.modules.schedule.saved_view_entity import register as register_activity_entity

    register_schedule_permissions()
    # Register the schedule_activity saved-views entity so a layout's static
    # filter rides the audited whitelist. Idempotent across repeated startups.
    if entity_registry.get(ACTIVITY_ENTITY_TYPE) is None:
        register_activity_entity()
