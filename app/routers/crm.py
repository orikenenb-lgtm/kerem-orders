"""
נתיבי CRM — leads (אדמין בלבד; require_admin בכל endpoint).
מודול אדיטיבי: נטען רק כאשר CRM_ENABLED=true (ראה app/main.py).
כל ה-I/O דרך user client → ה-RLS על crm_leads נאכף גם ברמת ה-DB.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_access_token, require_admin
from app.schemas.auth import UserOut
from app.schemas.crm import LeadCreate, LeadOut, LeadUpdate
from app.services.crm_service import (
    CrmLeadValidationError,
    build_lead_payload,
    build_lead_update,
)
from app.services.supabase_client import get_user_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/crm", tags=["crm"])


def _lead_out(row: dict) -> LeadOut:
    return LeadOut(
        id=row["id"],
        name=row["name"],
        phone=row.get("phone"),
        email=row.get("email"),
        source=row.get("source"),
        status=row["status"],
        notes=row.get("notes"),
        created_at=str(row["created_at"]),
    )


@router.post("/leads", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
def create_lead(
    body: LeadCreate,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> LeadOut:
    """יצירת ליד חדש. הכתיבה בזהות האדמין — ה-RLS אוכף הרשאה גם ב-DB."""
    client = get_user_client(token)
    payload = build_lead_payload(body, user.id)
    inserted = client.table("crm_leads").insert(payload).execute()
    if not inserted.data:
        raise HTTPException(status_code=500, detail="יצירת הליד נכשלה — נסה שוב")
    return _lead_out(inserted.data[0])


@router.get("/leads", response_model=list[LeadOut])
def list_leads(
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
    status_filter: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None, max_length=100),
) -> list[LeadOut]:
    """כל הלידים, אופציונלית מסוננים לפי סטטוס/חיפוש, מהחדש לישן."""
    client = get_user_client(token)
    query = client.table("crm_leads").select("*").order("created_at", desc=True)
    if status_filter:
        query = query.eq("status", status_filter)
    if search:
        query = query.or_(f"name.ilike.%{search}%,phone.ilike.%{search}%")
    rows = query.execute().data or []
    return [_lead_out(row) for row in rows]


@router.get("/leads/{lead_id}", response_model=LeadOut)
def get_lead(
    lead_id: str,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> LeadOut:
    """ליד בודד. לא נמצא → 404 (גם אם ה-RLS פשוט לא החזיר אותו)."""
    client = get_user_client(token)
    result = client.table("crm_leads").select("*").eq("id", lead_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="הליד לא נמצא")
    return _lead_out(result.data[0])


@router.patch("/leads/{lead_id}", response_model=LeadOut)
def update_lead(
    lead_id: str,
    body: LeadUpdate,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> LeadOut:
    """עדכון סטטוס/הערות לליד."""
    client = get_user_client(token)
    try:
        fields = build_lead_update(body)
    except CrmLeadValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    existing = client.table("crm_leads").select("id").eq("id", lead_id).limit(1).execute()
    if not existing.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="הליד לא נמצא")

    updated = client.table("crm_leads").update(fields).eq("id", lead_id).execute()
    if not updated.data:
        raise HTTPException(status_code=500, detail="העדכון נכשל — נסה שוב")
    return _lead_out(updated.data[0])
