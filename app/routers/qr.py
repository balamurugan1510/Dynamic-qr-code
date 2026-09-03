import io
import os
import socket
import zipfile
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse

from app import database as db
from app.models import (
    BatchCreateRequest,
    AssignRequest,
    ReassignRequest,
    StatusUpdateRequest,
    QRResponse,
)
from app.utils.qr_generator import generate_qr_png

router = APIRouter(prefix="/qr", tags=["QR Codes"])


def get_local_ip() -> str:
    """Detect LAN IP of the host machine so phone scans work over local Wi-Fi."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _base_url(request: Request) -> str:
    env_base = os.getenv("BASE_URL")
    if env_base:
        return env_base.rstrip("/")
    base = str(request.base_url).rstrip("/")
    # If accessed via localhost or loopback, replace with actual LAN IP for mobile scan compatibility
    if "localhost" in base or "127.0.0.1" in base:
        local_ip = get_local_ip()
        port = request.url.port or 8000
        scheme = request.url.scheme or "http"
        return f"{scheme}://{local_ip}:{port}"
    return base


# ── Batch generate ──────────────────────────────────────────────────────────

@router.post("/batch", response_model=list[QRResponse])
async def batch_create(body: BatchCreateRequest, request: Request):
    """Bulk-generate N unassigned QR code entries."""
    if body.count < 1 or body.count > 500:
        raise HTTPException(status_code=400, detail="count must be between 1 and 500")
    rows = await db.bulk_create(body.count, body.label_prefix)
    base = _base_url(request)
    return [QRResponse.from_db(r, base) for r in rows]


# ── List all ────────────────────────────────────────────────────────────────

@router.get("/list", response_model=list[QRResponse])
async def list_qr_codes(request: Request, status: Optional[str] = None):
    """List all QR codes, optionally filtered by status."""
    rows = await db.list_all(status_filter=status)
    base = _base_url(request)
    return [QRResponse.from_db(r, base) for r in rows]


# ── Get single QR info ───────────────────────────────────────────────────────

@router.get("/{code}/stats")
async def get_stats(code: str, request: Request):
    row = await db.get_qr(code)
    if not row:
        raise HTTPException(status_code=404, detail="QR code not found")
    base = _base_url(request)
    return QRResponse.from_db(row, base)


# ── Serve QR image (PNG) ─────────────────────────────────────────────────────

@router.get("/{code}/image")
async def get_qr_image(code: str, request: Request):
    row = await db.get_qr(code)
    if not row:
        raise HTTPException(status_code=404, detail="QR code not found")
    redirect_url = f"{_base_url(request)}/r/{code}"
    png_bytes = generate_qr_png(redirect_url)
    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={"Cache-Control": "no-cache"},
    )


# ── Download single QR as PNG file ───────────────────────────────────────────

@router.get("/{code}/download")
async def download_qr(code: str, request: Request):
    row = await db.get_qr(code)
    if not row:
        raise HTTPException(status_code=404, detail="QR code not found")
    redirect_url = f"{_base_url(request)}/r/{code}"
    png_bytes = generate_qr_png(redirect_url)
    label_safe = row["label"].replace(" ", "_").replace("/", "-")
    return StreamingResponse(
        io.BytesIO(png_bytes),
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="{label_safe}_{code}.png"'},
    )


# ── Download ALL QRs as ZIP ───────────────────────────────────────────────────

@router.get("/download/zip")
async def download_all_zip(request: Request, status: Optional[str] = None):
    """Download all (or filtered) QR codes as a single ZIP file."""
    rows = await db.list_all(status_filter=status)
    if not rows:
        raise HTTPException(status_code=404, detail="No QR codes found")

    base = _base_url(request)
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            redirect_url = f"{base}/r/{row['short_code']}"
            png_bytes = generate_qr_png(redirect_url)
            label_safe = row["label"].replace(" ", "_").replace("/", "-")
            filename = f"{label_safe}_{row['short_code']}.png"
            zf.writestr(filename, png_bytes)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="qr_codes.zip"'},
    )


# ── Assign URL (UNASSIGNED → ACTIVE) ─────────────────────────────────────────

@router.patch("/{code}/assign", response_model=QRResponse)
async def assign(code: str, body: AssignRequest, request: Request):
    row = await db.get_qr(code)
    if not row:
        raise HTTPException(status_code=404, detail="QR code not found")
    updated = await db.assign_url(code, body.target_url, body.label)
    return QRResponse.from_db(updated, _base_url(request))


# ── Reassign / change URL (already ACTIVE) ───────────────────────────────────

@router.patch("/{code}/reassign", response_model=QRResponse)
async def reassign(code: str, body: ReassignRequest, request: Request):
    row = await db.get_qr(code)
    if not row:
        raise HTTPException(status_code=404, detail="QR code not found")
    updated = await db.reassign_url(code, body.target_url)
    return QRResponse.from_db(updated, _base_url(request))


# ── Update status (ACTIVE / INACTIVE / EXPIRED) ───────────────────────────────

@router.patch("/{code}/status", response_model=QRResponse)
async def set_status(code: str, body: StatusUpdateRequest, request: Request):
    row = await db.get_qr(code)
    if not row:
        raise HTTPException(status_code=404, detail="QR code not found")
    if body.status == "ACTIVE" and not row.get("target_url"):
        raise HTTPException(
            status_code=400,
            detail="Cannot set ACTIVE without a target URL. Use /assign first.",
        )
    updated = await db.update_status(code, body.status)
    return QRResponse.from_db(updated, _base_url(request))


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{code}")
async def delete(code: str):
    success = await db.delete_qr(code)
    if not success:
        raise HTTPException(status_code=404, detail="QR code not found")
    return {"success": True}
