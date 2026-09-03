from typing import Optional, Literal
from pydantic import BaseModel, HttpUrl


class BatchCreateRequest(BaseModel):
    count: int
    label_prefix: str = "QR"


class AssignRequest(BaseModel):
    target_url: str
    label: Optional[str] = None


class ReassignRequest(BaseModel):
    target_url: str


class StatusUpdateRequest(BaseModel):
    status: Literal["ACTIVE", "INACTIVE", "EXPIRED"]


class QRResponse(BaseModel):
    short_code: str
    label: str
    target_url: Optional[str]
    status: str
    scan_count: int
    created_at: str
    assigned_at: Optional[str]
    updated_at: str
    qr_image_url: str
    redirect_url: str

    @classmethod
    def from_db(cls, row: dict, base_url: str) -> "QRResponse":
        return cls(
            short_code=row["short_code"],
            label=row["label"],
            target_url=row.get("target_url"),
            status=row["status"],
            scan_count=row["scan_count"],
            created_at=row["created_at"],
            assigned_at=row.get("assigned_at"),
            updated_at=row["updated_at"],
            qr_image_url=f"{base_url}/qr/{row['short_code']}/image",
            redirect_url=f"{base_url}/r/{row['short_code']}",
        )
