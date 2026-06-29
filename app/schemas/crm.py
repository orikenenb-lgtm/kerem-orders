"""סכמות CRM — leads (מודול אדיטיבי). כל הישויות בקידומת crm_."""
from pydantic import BaseModel, EmailStr, Field

LEAD_STATUSES = ("new", "contacted", "qualified", "converted", "lost")
LEAD_SOURCES = ("phone", "whatsapp", "email", "referral", "website", "other")


class LeadCreate(BaseModel):
    """יצירת ליד חדש — רק השם חובה; שאר השדות אופציונליים."""
    name: str = Field(min_length=2, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    email: EmailStr | None = None
    source: str | None = Field(default=None, pattern="^(" + "|".join(LEAD_SOURCES) + ")$")
    notes: str | None = Field(default=None, max_length=2000)


class LeadUpdate(BaseModel):
    """עדכון ליד — סטטוס ו/או הערות (אדמין)."""
    status: str | None = Field(default=None, pattern="^(" + "|".join(LEAD_STATUSES) + ")$")
    notes: str | None = Field(default=None, max_length=2000)


class LeadOut(BaseModel):
    """ליד כפי שהוא מוחזר מה-API."""
    id: str
    name: str
    phone: str | None = None
    email: str | None = None
    source: str | None = None
    status: str
    notes: str | None = None
    created_at: str
