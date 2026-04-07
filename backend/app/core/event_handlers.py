"""Cross-module event handlers -- wires the critical inter-module dataflows.

Imported at startup to register all handlers with the event bus.
Each handler is thin: validates the event, calls the target module's service.

Dataflows wired:
  1. meeting.action_item.created   -> auto-create task
  2. safety.observation.high_risk  -> notify PM + safety officer
  3. inspection.completed.failed   -> log for possible punch item creation
  4. rfi.response.design_change    -> flag for variation (change order)
  5. ncr.cost_impact               -> flag for variation (change order)
  6. document.revision.created     -> flag linked BOQ positions
  7. invoice.paid                  -> update project budget actuals
  8. po.issued                     -> update project budget committed
"""

import logging

from app.core.events import Event, event_bus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. meeting.action_item.created -> auto-create task
# ---------------------------------------------------------------------------

async def _handle_meeting_action_item_created(event: Event) -> None:
    """Create a task for each open action item from a meeting.

    Expected event.data:
        project_id: str (UUID)
        meeting_id: str (UUID)
        action_items: list[dict] with keys:
            description, owner_id, due_date, status
        created_by: str (UUID, optional)
    """
    try:
        data = event.data
        project_id = data.get("project_id")
        meeting_id = data.get("meeting_id")
        action_items = data.get("action_items", [])
        created_by = data.get("created_by")

        if not project_id or not action_items:
            logger.debug("meeting.action_item.created: missing project_id or action_items")
            return

        # Lazy import to avoid circular dependencies
        from app.database import async_session_factory
        from app.modules.tasks.schemas import TaskCreate
        from app.modules.tasks.service import TaskService

        async with async_session_factory() as session:
            svc = TaskService(session)
            created_count = 0
            for item in action_items:
                if item.get("status") != "open":
                    continue
                task_data = TaskCreate(
                    project_id=project_id,
                    task_type="task",
                    title=item.get("description", "Action item from meeting")[:500],
                    responsible_id=item.get("owner_id"),
                    due_date=item.get("due_date"),
                    meeting_id=str(meeting_id) if meeting_id else None,
                    status="open",
                    priority="normal",
                    metadata={"source": "meeting_action_item", "meeting_id": str(meeting_id)},
                )
                await svc.create_task(task_data, user_id=created_by)
                created_count += 1
            await session.commit()

        logger.info(
            "meeting.action_item.created: created %d tasks for meeting %s",
            created_count,
            meeting_id,
        )
    except Exception:
        logger.exception("Error handling meeting.action_item.created")


# ---------------------------------------------------------------------------
# 2. safety.observation.high_risk -> notify PM + safety officer
# ---------------------------------------------------------------------------

async def _handle_safety_observation_high_risk(event: Event) -> None:
    """Notify PM and safety officer when observation risk_score > 15.

    Expected event.data:
        project_id: str (UUID)
        observation_id: str (UUID)
        observation_number: str
        risk_score: int
        description: str
        notify_user_ids: list[str] (UUIDs of PM + safety officer)
    """
    try:
        data = event.data
        observation_id = data.get("observation_id")
        risk_score = data.get("risk_score", 0)
        notify_user_ids = data.get("notify_user_ids", [])
        description = data.get("description", "")
        observation_number = data.get("observation_number", "")

        if risk_score <= 15:
            logger.debug(
                "safety.observation.high_risk: risk_score=%d <= 15, skipping",
                risk_score,
            )
            return

        if not notify_user_ids:
            logger.debug("safety.observation.high_risk: no users to notify")
            return

        from app.database import async_session_factory
        from app.modules.notifications.service import NotificationService

        async with async_session_factory() as session:
            svc = NotificationService(session)
            await svc.notify_users(
                user_ids=notify_user_ids,
                notification_type="warning",
                title_key="notifications.safety.high_risk_observation",
                entity_type="safety_observation",
                entity_id=str(observation_id),
                body_key="notifications.safety.high_risk_body",
                body_context={
                    "observation_number": observation_number,
                    "risk_score": risk_score,
                    "description": description[:200],
                },
                action_url=f"/safety?observation={observation_id}",
            )
            await session.commit()

        logger.info(
            "safety.observation.high_risk: notified %d users for observation %s (risk=%d)",
            len(notify_user_ids),
            observation_number,
            risk_score,
        )
    except Exception:
        logger.exception("Error handling safety.observation.high_risk")


# ---------------------------------------------------------------------------
# 3. inspection.completed.failed -> log for possible punch item
# ---------------------------------------------------------------------------

async def _handle_inspection_completed_failed(event: Event) -> None:
    """Log failed inspection for UI to offer punch item creation.

    Expected event.data:
        project_id: str (UUID)
        inspection_id: str (UUID)
        inspection_number: str
        result: str ("fail" / "conditional_pass")
        failed_items: list[dict] (checklist items that failed)
    """
    try:
        data = event.data
        inspection_id = data.get("inspection_id")
        inspection_number = data.get("inspection_number", "")
        result = data.get("result", "")

        logger.info(
            "inspection.completed.failed: inspection %s (%s) result=%s -- "
            "UI may offer punch item creation",
            inspection_number,
            inspection_id,
            result,
        )

        # Re-emit a more specific event that the frontend can subscribe to via
        # WebSocket or the UI can poll for.  For now, we simply log it.
        await event_bus.publish(
            "punchlist.suggestion.from_inspection",
            data={
                "project_id": data.get("project_id"),
                "inspection_id": inspection_id,
                "inspection_number": inspection_number,
                "result": result,
                "failed_items": data.get("failed_items", []),
            },
            source_module="event_handlers",
        )
    except Exception:
        logger.exception("Error handling inspection.completed.failed")


# ---------------------------------------------------------------------------
# 4. rfi.response.design_change -> flag for variation
# ---------------------------------------------------------------------------

async def _handle_rfi_response_design_change(event: Event) -> None:
    """Flag RFI response with cost_impact for potential variation/change order.

    Expected event.data:
        project_id: str (UUID)
        rfi_id: str (UUID)
        rfi_number: str
        cost_impact: bool
        cost_impact_value: str | None
        schedule_impact: bool
        schedule_impact_days: int | None
        subject: str
    """
    try:
        data = event.data
        rfi_id = data.get("rfi_id")
        rfi_number = data.get("rfi_number", "")
        cost_impact = data.get("cost_impact", False)

        if not cost_impact:
            logger.debug("rfi.response.design_change: no cost_impact, skipping")
            return

        logger.info(
            "rfi.response.design_change: RFI %s has cost_impact, emitting variation flag",
            rfi_number,
        )

        await event_bus.publish(
            "variation.flagged",
            data={
                "project_id": data.get("project_id"),
                "source_type": "rfi",
                "source_id": str(rfi_id),
                "source_number": rfi_number,
                "subject": data.get("subject", ""),
                "cost_impact_value": data.get("cost_impact_value"),
                "schedule_impact": data.get("schedule_impact", False),
                "schedule_impact_days": data.get("schedule_impact_days"),
            },
            source_module="event_handlers",
        )
    except Exception:
        logger.exception("Error handling rfi.response.design_change")


# ---------------------------------------------------------------------------
# 5. ncr.cost_impact -> flag for variation
# ---------------------------------------------------------------------------

async def _handle_ncr_cost_impact(event: Event) -> None:
    """Flag NCR with cost_impact > 0 for potential variation/change order.

    Expected event.data:
        project_id: str (UUID)
        ncr_id: str (UUID)
        ncr_number: str
        cost_impact: str (monetary value as string, e.g. "15000")
        title: str
    """
    try:
        data = event.data
        ncr_id = data.get("ncr_id")
        ncr_number = data.get("ncr_number", "")
        cost_impact = data.get("cost_impact", "0")

        # Parse cost_impact; treat non-numeric as zero
        try:
            cost_value = float(str(cost_impact).replace(",", ""))
        except (ValueError, TypeError):
            cost_value = 0.0

        if cost_value <= 0:
            logger.debug("ncr.cost_impact: cost_impact=%s <= 0, skipping", cost_impact)
            return

        logger.info(
            "ncr.cost_impact: NCR %s has cost_impact=%s, emitting variation flag",
            ncr_number,
            cost_impact,
        )

        await event_bus.publish(
            "variation.flagged",
            data={
                "project_id": data.get("project_id"),
                "source_type": "ncr",
                "source_id": str(ncr_id),
                "source_number": ncr_number,
                "subject": data.get("title", ""),
                "cost_impact_value": cost_impact,
                "schedule_impact": False,
                "schedule_impact_days": data.get("schedule_impact_days"),
            },
            source_module="event_handlers",
        )
    except Exception:
        logger.exception("Error handling ncr.cost_impact")


# ---------------------------------------------------------------------------
# 6. document.revision.created -> flag linked BOQ positions
# ---------------------------------------------------------------------------

async def _handle_document_revision_created(event: Event) -> None:
    """Log new document revision for affected BOQ positions.

    Expected event.data:
        project_id: str (UUID)
        document_id: str (UUID)
        document_name: str
        revision_code: str
        previous_revision_id: str | None (UUID)
        affected_boq_position_ids: list[str] (UUIDs, if known)
    """
    try:
        data = event.data
        document_id = data.get("document_id")
        document_name = data.get("document_name", "")
        revision_code = data.get("revision_code", "")
        affected_ids = data.get("affected_boq_position_ids", [])

        logger.info(
            "document.revision.created: document '%s' rev %s -- %d linked BOQ positions",
            document_name,
            revision_code,
            len(affected_ids),
        )

        if affected_ids:
            await event_bus.publish(
                "boq.positions.revision_flagged",
                data={
                    "project_id": data.get("project_id"),
                    "document_id": str(document_id),
                    "document_name": document_name,
                    "revision_code": revision_code,
                    "affected_position_ids": affected_ids,
                },
                source_module="event_handlers",
            )
    except Exception:
        logger.exception("Error handling document.revision.created")


# ---------------------------------------------------------------------------
# 7. invoice.paid -> update project budget actuals
# ---------------------------------------------------------------------------

async def _handle_invoice_paid(event: Event) -> None:
    """Recalculate project budget actuals when an invoice is paid.

    Expected event.data:
        project_id: str (UUID)
        invoice_id: str (UUID)
        amount_total: str (monetary value)
        currency_code: str
    """
    try:
        data = event.data
        project_id = data.get("project_id")
        invoice_id = data.get("invoice_id")
        amount_total = data.get("amount_total", "0")

        if not project_id:
            logger.debug("invoice.paid: missing project_id")
            return

        from decimal import Decimal, InvalidOperation

        from sqlalchemy import select

        from app.database import async_session_factory
        from app.modules.finance.models import Invoice, ProjectBudget

        async with async_session_factory() as session:
            # Sum all paid invoices for the project
            result = await session.execute(
                select(Invoice).where(
                    Invoice.project_id == project_id,
                    Invoice.status == "paid",
                )
            )
            paid_invoices = result.scalars().all()

            total_actual = Decimal("0")
            for inv in paid_invoices:
                try:
                    total_actual += Decimal(str(inv.amount_total))
                except (InvalidOperation, ValueError):
                    continue

            # Update all budget lines for the project (aggregate level)
            budget_result = await session.execute(
                select(ProjectBudget).where(ProjectBudget.project_id == project_id)
            )
            budgets = budget_result.scalars().all()
            for budget in budgets:
                budget.actual = str(total_actual)

            await session.commit()

        logger.info(
            "invoice.paid: updated budget actuals for project %s (invoice %s, total_actual=%s)",
            project_id,
            invoice_id,
            total_actual,
        )
    except Exception:
        logger.exception("Error handling invoice.paid")


# ---------------------------------------------------------------------------
# 8. po.issued -> update project budget committed
# ---------------------------------------------------------------------------

async def _handle_po_issued(event: Event) -> None:
    """Recalculate project budget committed when a PO is issued.

    Expected event.data:
        project_id: str (UUID)
        po_id: str (UUID)
        amount_total: str (monetary value)
        currency_code: str
    """
    try:
        data = event.data
        project_id = data.get("project_id")
        po_id = data.get("po_id")

        if not project_id:
            logger.debug("po.issued: missing project_id")
            return

        from decimal import Decimal, InvalidOperation

        from sqlalchemy import select

        from app.database import async_session_factory
        from app.modules.finance.models import ProjectBudget
        from app.modules.procurement.models import PurchaseOrder

        async with async_session_factory() as session:
            # Sum all issued POs for the project
            result = await session.execute(
                select(PurchaseOrder).where(
                    PurchaseOrder.project_id == project_id,
                    PurchaseOrder.status == "issued",
                )
            )
            issued_pos = result.scalars().all()

            total_committed = Decimal("0")
            for po in issued_pos:
                try:
                    total_committed += Decimal(str(po.amount_total))
                except (InvalidOperation, ValueError):
                    continue

            # Update budget lines for the project
            budget_result = await session.execute(
                select(ProjectBudget).where(ProjectBudget.project_id == project_id)
            )
            budgets = budget_result.scalars().all()
            for budget in budgets:
                budget.committed = str(total_committed)

            await session.commit()

        logger.info(
            "po.issued: updated budget committed for project %s (po %s, total_committed=%s)",
            project_id,
            po_id,
            total_committed,
        )
    except Exception:
        logger.exception("Error handling po.issued")


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_event_handlers() -> None:
    """Register all cross-module event handlers with the global event bus.

    Call this at startup after all modules are loaded.
    """
    event_bus.subscribe("meeting.action_item.created", _handle_meeting_action_item_created)
    event_bus.subscribe("safety.observation.high_risk", _handle_safety_observation_high_risk)
    event_bus.subscribe("inspection.completed.failed", _handle_inspection_completed_failed)
    event_bus.subscribe("rfi.response.design_change", _handle_rfi_response_design_change)
    event_bus.subscribe("ncr.cost_impact", _handle_ncr_cost_impact)
    event_bus.subscribe("document.revision.created", _handle_document_revision_created)
    event_bus.subscribe("invoice.paid", _handle_invoice_paid)
    event_bus.subscribe("po.issued", _handle_po_issued)

    logger.info("Registered %d cross-module event handlers", 8)
