from fastapi import APIRouter
from moomoo import RET_OK

from config import OPEND_HOST, OPEND_PORT
from opend import quote_ctx

router = APIRouter()


@router.get("/health")
def health() -> dict:
    opend = f"{OPEND_HOST}:{OPEND_PORT}"
    try:
        with quote_ctx() as ctx:
            ret, _ = ctx.get_global_state()
        return {"ok": ret == RET_OK, "opend": opend}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "opend": opend}
