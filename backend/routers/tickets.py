import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
import models
import schemas
from utils import (
    require_user, log_action, update_db_object, delete_db_object
)
from routers.notifications import send_push_notification_for_triage

logger = logging.getLogger("backend.routers.tickets")
router = APIRouter(tags=["tickets"])

@router.get("/api/tickets", response_model=List[schemas.TicketWithDetails])
async def get_all_tickets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Ticket)
        .join(models.Floorplan)
        .join(models.Site)
        .join(models.User, models.Ticket.created_by_id == models.User.id)
        .options(
            selectinload(models.Ticket.floorplan).selectinload(models.Floorplan.site),
            selectinload(models.Ticket.creator)
        )
    )
    tickets_list = result.scalars().all()
    return [
        {
            "id": t.id,
            "floorplan_id": t.floorplan_id,
            "title": t.title,
            "description": t.description,
            "x_coordinate": t.x_coordinate,
            "y_coordinate": t.y_coordinate,
            "status": t.status,
            "created_by_id": t.created_by_id,
            "created_at": t.created_at,
            "floorplan_name": t.floorplan.name if t.floorplan else "",
            "site_name": t.floorplan.site.name if t.floorplan and t.floorplan.site else "",
            "site_id": t.floorplan.site_id if t.floorplan else 0,
            "creator_username": t.creator.username if t.creator else "Unknown",
            "creator_name": (t.creator.full_name or t.creator.username) if t.creator else "Unknown",
        }
        for t in tickets_list
    ]

@router.post("/api/tickets", response_model=schemas.Ticket)
async def create_ticket(
    ticket: schemas.TicketCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    db_ticket = models.Ticket(
        **ticket.model_dump(),
        created_by_id=current_user.id
    )
    db.add(db_ticket)
    await db.commit()
    await db.refresh(db_ticket)
    await log_action(db, "create", "ticket", db_ticket.id, db_ticket.title, new_values=ticket.model_dump(), message=f"Created ticket \"{db_ticket.title}\"", user=current_user)
    await db.commit()

    try:
        await send_push_notification_for_triage(
            db,
            title="EquipMap",
            body="You have a new maintenance request to triage.",
            url="/tickets"
        )
    except Exception as e:
        logger.error(f"Error sending triage push notification for ticket {db_ticket.id}: {e}")

    return db_ticket

@router.put("/api/tickets/{ticket_id}", response_model=schemas.Ticket)
async def update_ticket(
    ticket_id: int,
    ticket_data: schemas.TicketUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    result = await db.execute(select(models.Ticket).where(models.Ticket.id == ticket_id))
    db_ticket = result.scalars().first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if current_user.id != db_ticket.created_by_id and current_user.role not in ["admin", "editor"]:
        raise HTTPException(status_code=403, detail="You do not have permission to update this ticket")

    return await update_db_object(db, db_ticket, ticket_data, "ticket", name_attr="title", user=current_user)

@router.delete("/api/tickets/{ticket_id}")
async def delete_ticket(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_user)
):
    result = await db.execute(select(models.Ticket).where(models.Ticket.id == ticket_id))
    db_ticket = result.scalars().first()
    if not db_ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if current_user.id != db_ticket.created_by_id and current_user.role not in ["admin", "editor"]:
        raise HTTPException(status_code=403, detail="You do not have permission to delete this ticket")

    await delete_db_object(db, db_ticket, "ticket", name_attr="title", user=current_user)
    return {"status": "success"}
