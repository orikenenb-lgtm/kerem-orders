"""
בדיקות CRM (leads) — מודול אדיטיבי מאחורי דגל CRM_ENABLED.
בודק את שני המסלולים: דגל כבוי (אין נתיבים כלל) ודגל דלוק (נתיבים + הרשאות),
ואת לוגיקת build_lead_* ישירות (בלי DB) — בסגנון test_orders.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.dependencies import get_access_token, get_current_user
from app.main import app as main_app
from app.routers import crm
from app.schemas.auth import UserOut
from app.schemas.crm import LeadCreate, LeadUpdate
from app.services.crm_service import (
    CrmLeadValidationError,
    build_lead_payload,
    build_lead_update,
)

ADMIN = UserOut(id="admin-1", email="admin@test.il", role="admin", status="active")
CUSTOMER = UserOut(id="cust-1", email="cust@test.il", role="customer", status="active")


def _enabled_app() -> FastAPI:
    """app נפרד עם ראוטר ה-CRM מותקן — מדמה CRM_ENABLED=true."""
    a = FastAPI()
    a.include_router(crm.router)
    return a


# ---------- דגל כבוי (ברירת מחדל): אין נתיבי /crm בכלל ----------

def test_crm_disabled_by_default_no_routes():
    """CRM_ENABLED=false (ברירת מחדל) → ה-app הראשי לא כולל /crm → 404."""
    client = TestClient(main_app)
    assert client.get("/crm/leads").status_code == 404
    assert client.post("/crm/leads", json={"name": "פלוני אלמוני"}).status_code == 404


# ---------- דגל דלוק: נתיבים קיימים + מוגנים ----------

def test_crm_enabled_requires_auth():
    """דלוק אך בלי טוקן → 401 (require_admin)."""
    client = TestClient(_enabled_app())
    assert client.get("/crm/leads").status_code == 401
    assert client.post("/crm/leads", json={"name": "פלוני אלמוני"}).status_code == 401


def test_crm_enabled_rejects_non_admin():
    """דלוק, משתמש לקוח (לא אדמין) → 403."""
    a = _enabled_app()
    a.dependency_overrides[get_current_user] = lambda: CUSTOMER
    a.dependency_overrides[get_access_token] = lambda: "t"
    client = TestClient(a)
    assert client.get("/crm/leads").status_code == 403
    a.dependency_overrides.clear()


def test_crm_create_validation_422():
    """דלוק, אדמין, אך שם חסר/קצר מדי → 422 (סכמה), בלי לגעת ב-DB."""
    a = _enabled_app()
    a.dependency_overrides[get_current_user] = lambda: ADMIN
    a.dependency_overrides[get_access_token] = lambda: "t"
    client = TestClient(a)
    assert client.post("/crm/leads", json={"name": "א"}).status_code == 422
    assert client.post("/crm/leads", json={}).status_code == 422
    a.dependency_overrides.clear()


# ---------- לוגיקה טהורה (בלי DB) ----------

def test_build_lead_payload_defaults_status_new():
    """ליד חדש מתחיל תמיד בסטטוס 'new', והשם עובר strip."""
    payload = build_lead_payload(LeadCreate(name="  ישראל ישראלי  "), "admin-1")
    assert payload["status"] == "new"
    assert payload["name"] == "ישראל ישראלי"
    assert payload["created_by"] == "admin-1"


def test_lead_create_rejects_invalid_source():
    """source מחוץ לרשימה הסגורה → ValidationError."""
    with pytest.raises(ValidationError):
        LeadCreate(name="פלוני", source="not-a-source")


def test_build_lead_update_empty_raises_400():
    """עדכון בלי שום שדה → CrmLeadValidationError(400)."""
    with pytest.raises(CrmLeadValidationError) as exc:
        build_lead_update(LeadUpdate())
    assert exc.value.status_code == 400


def test_build_lead_update_collects_only_sent_fields():
    fields = build_lead_update(LeadUpdate(status="contacted", notes="התקשרתי"))
    assert fields == {"status": "contacted", "notes": "התקשרתי"}
