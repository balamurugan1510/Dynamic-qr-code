import os
import aiosqlite
import secrets
from datetime import datetime, timezone
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "qr_codes.db")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS qr_codes (
                short_code  TEXT PRIMARY KEY,
                label       TEXT NOT NULL,
                target_url  TEXT,
                status      TEXT NOT NULL DEFAULT 'UNASSIGNED',
                scan_count  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                assigned_at TEXT,
                updated_at  TEXT NOT NULL
            )
        """)
        await db.commit()


async def bulk_create(count: int, label_prefix: str) -> list[dict]:
    """Generate `count` new UNASSIGNED QR code rows and return them."""
    rows = []
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        for i in range(1, count + 1):
            code = secrets.token_urlsafe(6)
            label = f"{label_prefix}-{i:03d}"
            await db.execute(
                """INSERT INTO qr_codes (short_code, label, target_url, status, scan_count, created_at, assigned_at, updated_at)
                   VALUES (?, ?, NULL, 'UNASSIGNED', 0, ?, NULL, ?)""",
                (code, label, now, now),
            )
            rows.append({"short_code": code, "label": label, "status": "UNASSIGNED",
                         "target_url": None, "scan_count": 0,
                         "created_at": now, "assigned_at": None, "updated_at": now})
        await db.commit()
    return rows


async def get_qr(short_code: str) -> Optional[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM qr_codes WHERE short_code = ?", (short_code,)
        ) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def list_all(status_filter: Optional[str] = None) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if status_filter:
            async with db.execute(
                "SELECT * FROM qr_codes WHERE status = ? ORDER BY created_at DESC",
                (status_filter,),
            ) as cursor:
                rows = await cursor.fetchall()
        else:
            async with db.execute(
                "SELECT * FROM qr_codes ORDER BY created_at DESC"
            ) as cursor:
                rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def assign_url(short_code: str, target_url: str, label: Optional[str] = None) -> Optional[dict]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        if label:
            await db.execute(
                """UPDATE qr_codes SET target_url=?, status='ACTIVE', assigned_at=?, updated_at=?, label=?
                   WHERE short_code=?""",
                (target_url, now, now, label, short_code),
            )
        else:
            await db.execute(
                """UPDATE qr_codes SET target_url=?, status='ACTIVE', assigned_at=?, updated_at=?
                   WHERE short_code=?""",
                (target_url, now, now, short_code),
            )
        await db.commit()
    return await get_qr(short_code)


async def reassign_url(short_code: str, target_url: str) -> Optional[dict]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE qr_codes SET target_url=?, updated_at=? WHERE short_code=?",
            (target_url, now, short_code),
        )
        await db.commit()
    return await get_qr(short_code)


async def update_status(short_code: str, status: str) -> Optional[dict]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE qr_codes SET status=?, updated_at=? WHERE short_code=?",
            (status, now, short_code),
        )
        await db.commit()
    return await get_qr(short_code)


async def increment_scan(short_code: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE qr_codes SET scan_count = scan_count + 1 WHERE short_code = ?",
            (short_code,),
        )
        await db.commit()


async def delete_qr(short_code: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "DELETE FROM qr_codes WHERE short_code = ?", (short_code,)
        )
        await db.commit()
        return cursor.rowcount > 0
