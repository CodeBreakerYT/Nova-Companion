import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Dev mode: repo_root/.env (two levels up from this file) — your own key,
# never bundled anywhere.
if not getattr(sys, "frozen", False):
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")


def _read_key_from_text_file() -> str:
    """Packaged mode: the exe ships with no key baked in (see extraFiles in
    package.json) — whoever downloads the zip pastes their own Groq key into
    GROQ_API_KEY.txt sitting next to NOVA.exe. sys.executable here is the
    PyInstaller backend sidecar at <approot>/resources/backend/nova-backend.exe,
    so the app root (where NOVA.exe and the txt file live) is two levels up.

    The key always goes on the file's last non-empty line (see the template),
    so instructional text above it is never mistaken for the key itself.
    """
    app_root = Path(sys.executable).resolve().parents[2]
    key_file = app_root / "GROQ_API_KEY.txt"
    if not key_file.exists():
        return ""
    non_empty_lines = [line.strip() for line in key_file.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not non_empty_lines:
        return ""
    last_line = non_empty_lines[-1]
    return "" if last_line == "PASTE_YOUR_KEY_HERE" else last_line


GROQ_API_KEY = (
    _read_key_from_text_file() if getattr(sys, "frozen", False) else os.environ.get("GROQ_API_KEY", "")
)

HOST = os.environ.get("NOVA_HOST", "127.0.0.1")
PORT = int(os.environ.get("NOVA_PORT", "8765"))

# Directories NOVA is allowed to search/act on. Anything outside this list is
# refused by the file tools regardless of what the LLM asks for.
DEFAULT_ALLOWED_DIRS = [
    str(Path.home() / "Documents"),
    str(Path.home() / "Downloads"),
    str(Path.home() / "Desktop"),
]

if getattr(sys, "frozen", False):
    DATA_DIR = Path(sys.executable).resolve().parent / "data"
    SEED_AVATARS_DIR = Path(sys.executable).resolve().parent / "seed_avatars"
else:
    DATA_DIR = Path(__file__).parent / "memory" / "data"
    SEED_AVATARS_DIR = Path(__file__).parent / "seed_avatars"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Proactive check-ins: how long the same app/window has to stay focused
# before NOVA speaks up unprompted, and the minimum gap between check-ins so
# she doesn't nag. Both tunable via env for a live demo (short) vs real use
# (longer, less intrusive).
NUDGE_IDLE_SECONDS = int(os.environ.get("NOVA_NUDGE_IDLE_SECONDS", "180"))
NUDGE_COOLDOWN_SECONDS = int(os.environ.get("NOVA_NUDGE_COOLDOWN_SECONDS", "600"))
