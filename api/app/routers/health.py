from fastapi import APIRouter, Depends

from app.auth.database import User
from app.auth.users import current_active_user


router = APIRouter(
    prefix="/api",
    tags=["Health"],
    dependencies=[Depends(current_active_user)],
)


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
