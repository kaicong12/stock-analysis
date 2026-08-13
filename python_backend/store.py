"""SQLite cache of daily closes and OHLCV bars."""

import sqlite3
import threading
from contextlib import contextmanager

from config import DB_FILE

_lock = threading.Lock()
_inited = False

_SCHEMA = """
CREATE TABLE IF NOT EXISTS daily_closes (
  yf_ticker   TEXT NOT NULL,
  close_date  TEXT NOT NULL,
  close       REAL NOT NULL,
  PRIMARY KEY (yf_ticker, close_date)
);
CREATE TABLE IF NOT EXISTS daily_closes_sync (
  yf_ticker          TEXT PRIMARY KEY,
  last_refresh_date  TEXT NOT NULL,
  bars_count         INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_ohlcv (
  yf_ticker   TEXT NOT NULL,
  bar_date    TEXT NOT NULL,
  open        REAL NOT NULL,
  high        REAL NOT NULL,
  low         REAL NOT NULL,
  close       REAL NOT NULL,
  volume      REAL NOT NULL,
  PRIMARY KEY (yf_ticker, bar_date)
);
CREATE TABLE IF NOT EXISTS daily_ohlcv_sync (
  yf_ticker          TEXT PRIMARY KEY,
  last_refresh_date  TEXT NOT NULL,
  bars_count         INTEGER NOT NULL DEFAULT 0
);
"""


def init() -> None:
    """Idempotent schema + pragma setup."""
    global _inited
    if _inited:
        return
    with _lock:
        if _inited:
            return
        DB_FILE.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(DB_FILE, timeout=5) as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.executescript(_SCHEMA)
            conn.commit()
        _inited = True


@contextmanager
def db():
    """Yield a connection to the initialized cache database."""
    init()
    # timeout= sets busy_timeout, so a concurrent writer waits instead of SQLITE_BUSY.
    conn = sqlite3.connect(DB_FILE, timeout=5)
    try:
        yield conn
    finally:
        conn.close()
