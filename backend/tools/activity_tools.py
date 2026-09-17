from pydantic import BaseModel

from memory.activity import get_recent_activity


class RecentActivityArgs(BaseModel):
    pass


def recent_activity(_: RecentActivityArgs) -> dict:
    """What the user has actually been doing — recent foreground
    apps/windows, most recent first. Use this for 'what have I been
    working on' or to notice they've been stuck on one thing a while."""
    entries = get_recent_activity(limit=15)
    if not entries:
        return {"status": "ok", "count": 0, "results": [], "message": "Nothing tracked yet."}
    return {"status": "ok", "count": len(entries), "results": entries}
