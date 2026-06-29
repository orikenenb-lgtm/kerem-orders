"""
לוגיקת CRM (leads) — הרכבת payload וכללי עסק, ללא גישת DB (כמו orders_service).
הראוטר עושה את ה-I/O מול Supabase; כאן רק בנייה וולידציה — וכך גם קל לבדוק.
"""
from app.schemas.crm import LeadCreate, LeadUpdate


class CrmLeadValidationError(Exception):
    """שגיאת ולידציה עסקית בליד — נושאת status_code עבור ה-API."""

    def __init__(self, status_code: int, message: str) -> None:
        self.status_code = status_code
        super().__init__(message)


def build_lead_payload(body: LeadCreate, created_by: str) -> dict:
    """payload להכנסת ליד חדש. הסטטוס ההתחלתי קבוע 'new' — לא נשלט מהקלט."""
    return {
        "name": body.name.strip(),
        "phone": body.phone,
        "email": body.email,
        "source": body.source,
        "status": "new",
        "notes": body.notes,
        "created_by": created_by,
    }


def build_lead_update(body: LeadUpdate) -> dict:
    """אוסף רק את השדות שנשלחו לעדכון. בלי שום שדה → שגיאה 400."""
    fields: dict = {}
    if body.status is not None:
        fields["status"] = body.status
    if body.notes is not None:
        fields["notes"] = body.notes
    if not fields:
        raise CrmLeadValidationError(400, "לא נשלח שום שדה לעדכון")
    return fields
