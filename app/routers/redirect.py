import asyncio
from fastapi import APIRouter
from fastapi.responses import RedirectResponse, HTMLResponse

from app import database as db

router = APIRouter(tags=["Redirect"])

_PLAIN_STYLE = """
    body {
        margin: 0; display: flex; justify-content: center; align-items: center;
        min-height: 100vh; background: #0f0f1a; font-family: sans-serif;
        color: #ccc; text-align: center;
    }
    .box { padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; color: #fff; }
    p  { color: #888; }
"""


@router.get("/r/{code}")
async def redirect_qr(code: str):
    row = await db.get_qr(code)

    if not row:
        return HTMLResponse(
            content=f"""<!DOCTYPE html><html><head><title>Invalid QR</title>
            <style>{_PLAIN_STYLE}</style></head>
            <body><div class="box"><h1>❌ Invalid QR Code</h1>
            <p>This QR code does not exist.</p></div></body></html>""",
            status_code=404,
        )

    status = row["status"]

    if status == "UNASSIGNED":
        return HTMLResponse(
            content=f"""<!DOCTYPE html><html><head><title>QR Not Active</title>
            <style>{_PLAIN_STYLE}</style></head>
            <body><div class="box"><h1>⏳ Not yet active</h1>
            <p>This QR code has not been assigned yet.</p></div></body></html>""",
            status_code=200,
        )

    if status == "INACTIVE":
        return HTMLResponse(
            content=f"""<!DOCTYPE html><html><head><title>QR Paused</title>
            <style>{_PLAIN_STYLE}</style></head>
            <body><div class="box"><h1>⏸️ QR Paused</h1>
            <p>This QR code is temporarily disabled.</p></div></body></html>""",
            status_code=200,
        )

    if status == "EXPIRED":
        return HTMLResponse(
            content=f"""<!DOCTYPE html><html><head><title>QR Expired</title>
            <style>{_PLAIN_STYLE}</style></head>
            <body><div class="box"><h1>🚫 QR Expired</h1>
            <p>This QR code is no longer active.</p></div></body></html>""",
            status_code=200,
        )

    # ACTIVE — redirect and increment scan count asynchronously
    asyncio.create_task(db.increment_scan(code))
    return RedirectResponse(url=row["target_url"], status_code=302)
