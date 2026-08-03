"""moomoo OpenD connection."""

import threading
from contextlib import contextmanager

from moomoo import OpenQuoteContext

from config import OPEND_HOST, OPEND_PORT

# OpenD tolerates one context at a time far better than several, so every
# request serializes through this lock and opens/closes its own context.
_lock = threading.Lock()


@contextmanager
def quote_ctx():
    with _lock:
        ctx = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
        try:
            yield ctx
        finally:
            ctx.close()
