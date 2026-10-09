import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, delete, func, or_

from database import get_db
import models
import schemas
from utils import require_user, require_admin, log_action

logger = logging.getLogger("backend.routers.trades")
router = APIRouter(tags=["trades"])

DEFAULT_TRADES = ["Electrical", "HVAC", "Plumbing", "General Maintenance"]

@router.get("/api/trades", response_model=List[str])
async def get_trades(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_user)):
    """Returns a sorted list of all unique trade names registered in the system."""
    db_trades = (await db.execute(select(models.Trade.name))).scalars().all()
    user_trades = (await db.execute(select(models.User.trade).distinct().where(models.User.trade.is_not(None)))).scalars().all()
    pm_trades = (await db.execute(select(models.PMSchedule.trade).distinct().where(models.PMSchedule.trade.is_not(None)))).scalars().all()
    task_trades = (await db.execute(select(models.Task.trade).distinct().where(models.Task.trade.is_not(None)))).scalars().all()
    wo_trades = (await db.execute(select(models.WorkOrder.trade).distinct().where(models.WorkOrder.trade.is_not(None)))).scalars().all()

    unique_trades = set(DEFAULT_TRADES)
    for t in list(db_trades) + list(user_trades) + list(pm_trades) + list(task_trades) + list(wo_trades):
        if t and t.strip():
            unique_trades.add(t.strip())

    return sorted(list(unique_trades), key=lambda s: s.lower())

@router.get("/api/trades/summary", response_model=List[schemas.TradeSummary])
async def get_trades_summary(db: AsyncSession = Depends(get_db), current_user: models.User = Depends(require_user)):
    """Returns detailed statistics and usage counts for all registered trades."""
    # 1. Fetch all trades from database table
    db_trades_res = await db.execute(select(models.Trade).order_by(models.Trade.name.asc()))
    db_trades_list = db_trades_res.scalars().all()
    trades_by_name = {t.name.lower(): t for t in db_trades_list}

    # 2. Collect all distinct trade names in use
    all_trade_names = await get_trades(db=db, current_user=current_user)

    # 3. Aggregate user counts
    user_counts_res = await db.execute(
        select(models.User.trade, func.count(models.User.id))
        .where(models.User.trade.is_not(None))
        .group_by(models.User.trade)
    )
    user_counts = {row[0]: row[1] for row in user_counts_res.all() if row[0]}

    # 4. Aggregate PM Schedule counts
    pm_counts_res = await db.execute(
        select(models.PMSchedule.trade, func.count(models.PMSchedule.id))
        .where(models.PMSchedule.trade.is_not(None))
        .group_by(models.PMSchedule.trade)
    )
    pm_counts = {row[0]: row[1] for row in pm_counts_res.all() if row[0]}

    # 5. Aggregate Task counts
    task_counts_res = await db.execute(
        select(models.Task.trade, func.count(models.Task.id))
        .where(models.Task.trade.is_not(None))
        .group_by(models.Task.trade)
    )
    task_counts = {row[0]: row[1] for row in task_counts_res.all() if row[0]}

    # 6. Aggregate Work Order counts
    wo_counts_res = await db.execute(
        select(models.WorkOrder.trade, func.count(models.WorkOrder.id))
        .where(models.WorkOrder.trade.is_not(None))
        .group_by(models.WorkOrder.trade)
    )
    wo_counts = {row[0]: row[1] for row in wo_counts_res.all() if row[0]}

    summaries = []
    for trade_name in all_trade_names:
        t_entity = trades_by_name.get(trade_name.lower())
        summaries.append({
            "id": t_entity.id if t_entity else None,
            "name": trade_name,
            "description": t_entity.description if t_entity else None,
            "color": t_entity.color if t_entity else "#3b82f6",
            "user_count": user_counts.get(trade_name, 0),
            "pm_schedule_count": pm_counts.get(trade_name, 0),
            "task_count": task_counts.get(trade_name, 0),
            "work_order_count": wo_counts.get(trade_name, 0)
        })

    return summaries

@router.post("/api/trades", response_model=schemas.TradeSummary)
async def create_trade(
    payload: schemas.TradeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin)
):
    """Creates a new trade in the database."""
    trade_name = payload.name.strip()
    if not trade_name:
        raise HTTPException(status_code=400, detail="Trade name cannot be empty")

    existing_res = await db.execute(select(models.Trade).where(func.lower(models.Trade.name) == func.lower(trade_name)))
    if existing_res.scalars().first():
        raise HTTPException(status_code=400, detail=f"Trade '{trade_name}' already exists")

    new_trade = models.Trade(
        name=trade_name,
        description=payload.description.strip() if payload.description else None,
        color=payload.color or "#3b82f6"
    )
    db.add(new_trade)

    await log_action(
        db=db,
        action="create",
        target_type="trade",
        target_name=trade_name,
        new_values={"name": trade_name, "description": payload.description, "color": payload.color},
        message=f"Created new trade '{trade_name}'",
        user=current_user
    )

    await db.commit()
    await db.refresh(new_trade)

    return {
        "id": new_trade.id,
        "name": new_trade.name,
        "description": new_trade.description,
        "color": new_trade.color,
        "user_count": 0,
        "pm_schedule_count": 0,
        "task_count": 0,
        "work_order_count": 0
    }

@router.put("/api/trades/{trade_name}", response_model=schemas.TradeSummary)
async def update_trade(
    trade_name: str,
    payload: schemas.TradeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin)
):
    """
    Renames or updates a trade.
    If renamed, automatically cascades the change to all Users, PMSchedules, Tasks, and WorkOrders!
    """
    trade_name = trade_name.strip()
    new_name = payload.name.strip() if payload.name is not None else None

    if new_name is not None and not new_name:
        raise HTTPException(status_code=400, detail="Trade name cannot be empty")

    # Find or create Trade record
    trade_entity_res = await db.execute(select(models.Trade).where(func.lower(models.Trade.name) == func.lower(trade_name)))
    trade_entity = trade_entity_res.scalars().first()

    old_name = trade_entity.name if trade_entity else trade_name
    is_renaming = (new_name is not None and new_name != old_name)

    if is_renaming:
        # Verify new name is not already taken by another trade
        dup_res = await db.execute(select(models.Trade).where(func.lower(models.Trade.name) == func.lower(new_name)))
        existing_dup = dup_res.scalars().first()
        if existing_dup and (not trade_entity or existing_dup.id != trade_entity.id):
            raise HTTPException(status_code=400, detail=f"A trade named '{new_name}' already exists")

    if not trade_entity:
        trade_entity = models.Trade(
            name=new_name if is_renaming else old_name,
            description=payload.description,
            color=payload.color or "#3b82f6"
        )
        db.add(trade_entity)
    else:
        if is_renaming:
            trade_entity.name = new_name
        if payload.description is not None:
            trade_entity.description = payload.description.strip() if payload.description.strip() else None
        if payload.color is not None:
            trade_entity.color = payload.color

    # If renamed, cascade to all related tables
    if is_renaming:
        logger.info(f"Cascading trade rename from '{old_name}' to '{new_name}' across all entities...")
        await db.execute(
            update(models.User).where(models.User.trade == old_name).values(trade=new_name)
        )
        await db.execute(
            update(models.PMSchedule).where(models.PMSchedule.trade == old_name).values(trade=new_name)
        )
        await db.execute(
            update(models.Task).where(models.Task.trade == old_name).values(trade=new_name)
        )
        await db.execute(
            update(models.WorkOrder).where(models.WorkOrder.trade == old_name).values(trade=new_name)
        )

    await log_action(
        db=db,
        action="update",
        target_type="trade",
        target_id=trade_entity.id,
        target_name=trade_entity.name,
        old_values={"name": old_name},
        new_values={"name": trade_entity.name, "description": trade_entity.description, "color": trade_entity.color},
        message=f"Renamed trade '{old_name}' to '{new_name}' and updated all linked records" if is_renaming else f"Updated trade '{old_name}' details",
        user=current_user
    )

    await db.commit()
    await db.refresh(trade_entity)

    # Get updated counts for the response
    effective_name = trade_entity.name
    u_count = (await db.execute(select(func.count(models.User.id)).where(models.User.trade == effective_name))).scalar() or 0
    pm_count = (await db.execute(select(func.count(models.PMSchedule.id)).where(models.PMSchedule.trade == effective_name))).scalar() or 0
    t_count = (await db.execute(select(func.count(models.Task.id)).where(models.Task.trade == effective_name))).scalar() or 0
    wo_count = (await db.execute(select(func.count(models.WorkOrder.id)).where(models.WorkOrder.trade == effective_name))).scalar() or 0

    return {
        "id": trade_entity.id,
        "name": trade_entity.name,
        "description": trade_entity.description,
        "color": trade_entity.color,
        "user_count": u_count,
        "pm_schedule_count": pm_count,
        "task_count": t_count,
        "work_order_count": wo_count
    }

@router.delete("/api/trades/{trade_name}")
async def delete_trade(
    trade_name: str,
    payload: Optional[schemas.TradeDeletePayload] = None,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(require_admin)
):
    """
    Deletes a trade.
    If reassign_to is provided, moves all users, PMs, tasks, and work orders to that trade.
    Otherwise, sets trade to NULL for all linked entities.
    """
    trade_name = trade_name.strip()
    reassign_target = payload.reassign_to.strip() if (payload and payload.reassign_to and payload.reassign_to.strip()) else None

    # Cascade to related entities
    await db.execute(
        update(models.User).where(models.User.trade == trade_name).values(trade=reassign_target)
    )
    await db.execute(
        update(models.PMSchedule).where(models.PMSchedule.trade == trade_name).values(trade=reassign_target)
    )
    await db.execute(
        update(models.Task).where(models.Task.trade == trade_name).values(trade=reassign_target)
    )
    await db.execute(
        update(models.WorkOrder).where(models.WorkOrder.trade == trade_name).values(trade=reassign_target)
    )

    # Delete from trades table if present
    await db.execute(
        delete(models.Trade).where(func.lower(models.Trade.name) == func.lower(trade_name))
    )

    await log_action(
        db=db,
        action="delete",
        target_type="trade",
        target_name=trade_name,
        old_values={"name": trade_name},
        new_values={"reassigned_to": reassign_target},
        message=f"Deleted trade '{trade_name}' (Reassigned linked items to '{reassign_target}')" if reassign_target else f"Deleted trade '{trade_name}' (Cleared linked items)",
        user=current_user
    )

    await db.commit()

    return {
        "status": "success",
        "message": f"Trade '{trade_name}' successfully removed" + (f" and reassigned to '{reassign_target}'" if reassign_target else " and unlinked from records")
    }
