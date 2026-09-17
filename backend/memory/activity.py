import json
import threading
import time

import config

RECENT_PATH = config.DATA_DIR / "recent_files.json"
MAX_RECENT = 50
POLL_SECONDS = 2


def _load() -> list[dict]:
    if not RECENT_PATH.exists():
        return []
    try:
        return json.loads(RECENT_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save(entries: list[dict]) -> None:
    RECENT_PATH.write_text(json.dumps(entries, indent=2), encoding="utf-8")


def record_path(path: str) -> None:
    entries = [e for e in _load() if e["path"] != path]
    entries.insert(0, {"path": path, "seen_at": time.time()})
    _save(entries[:MAX_RECENT])


def get_recent(limit: int = 10) -> list[dict]:
    return _load()[:limit]


def _get_clipboard_file_paths() -> list[str]:
    try:
        import win32clipboard
        import win32con

        win32clipboard.OpenClipboard()
        try:
            if win32clipboard.IsClipboardFormatAvailable(win32con.CF_HDROP):
                data = win32clipboard.GetClipboardData(win32con.CF_HDROP)
                return list(data)
            return []
        finally:
            win32clipboard.CloseClipboard()
    except Exception:
        return []


def watch_clipboard() -> None:
    """Background loop: whenever the user copies a file/folder in Explorer,
    remember it — this is what lets NOVA answer 'where did I put the thing I
    just copied' instead of only ever full-text searching from scratch."""
    last_seen: tuple[str, ...] = ()
    while True:
        try:
            paths = tuple(_get_clipboard_file_paths())
            if paths and paths != last_seen:
                last_seen = paths
                for p in paths:
                    record_path(p)
        except Exception:
            pass
        time.sleep(POLL_SECONDS)


def start_clipboard_watcher() -> None:
    threading.Thread(target=watch_clipboard, daemon=True).start()


# ---------------------------------------------------------------------------
# Active-window tracking — "what has the user actually been working on,"
# not just files they touched. Polls the OS foreground window and logs a
# new entry only when the app or title actually changes, so an hour in one
# editor is one entry with a duration, not thousands of identical rows.
# ---------------------------------------------------------------------------

ACTIVITY_PATH = config.DATA_DIR / "activity_log.json"
MAX_ACTIVITY_ENTRIES = 200
ACTIVITY_POLL_SECONDS = 5


def _load_activity() -> list[dict]:
    if not ACTIVITY_PATH.exists():
        return []
    try:
        return json.loads(ACTIVITY_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_activity(entries: list[dict]) -> None:
    ACTIVITY_PATH.write_text(json.dumps(entries, indent=2), encoding="utf-8")


def _get_foreground_app() -> dict | None:
    try:
        import win32gui
        import win32process
        import win32api
        import win32con

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        title = win32gui.GetWindowText(hwnd)
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        try:
            handle = win32api.OpenProcess(win32con.PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            exe_path = win32process.GetModuleFileNameEx(handle, 0)
            win32api.CloseHandle(handle)
            app_name = exe_path.rsplit("\\", 1)[-1]
        except Exception:
            app_name = "Unknown"
        return {"app": app_name, "title": title}
    except Exception:
        return None


def get_recent_activity(limit: int = 20) -> list[dict]:
    return _load_activity()[:limit]


def watch_active_window() -> None:
    """Background loop tracking which app/window has focus, so NOVA can
    answer 'what have I been working on' or notice you've been heads-down
    in one thing for a while — this is the 'tracks my activity' half of
    being a personalized companion, not just a chatbot that waits to be
    asked something."""
    last_key: tuple[str, str] | None = None
    while True:
        try:
            current = _get_foreground_app()
            if current:
                key = (current["app"], current["title"])
                if key != last_key:
                    last_key = key
                    entries = _load_activity()
                    entries.insert(0, {"app": current["app"], "title": current["title"], "started_at": time.time()})
                    _save_activity(entries[:MAX_ACTIVITY_ENTRIES])
        except Exception:
            pass
        time.sleep(ACTIVITY_POLL_SECONDS)


def start_activity_watcher() -> None:
    threading.Thread(target=watch_active_window, daemon=True).start()


# ---------------------------------------------------------------------------
# Proactive check-ins — "works with you" instead of only "answers when
# asked." Reuses the same foreground-window polling as the activity log to
# notice when the user has been heads-down on one window for a while, and
# fires a callback (once per focus session, throttled by a cooldown) so NOVA
# can speak up on her own instead of waiting to be asked something.
# ---------------------------------------------------------------------------

_IGNORED_NUDGE_APPS = {
    "explorer.exe",
    "searchhost.exe",
    "shellhost.exe",
    "textinputhost.exe",
    "applicationframehost.exe",
    "lockapp.exe",
    "nova.exe",
}


def watch_for_nudges(on_nudge) -> None:
    last_key: tuple[str, str] | None = None
    focus_started_at = 0.0
    already_nudged_this_focus = False
    last_nudge_at = 0.0
    while True:
        try:
            current = _get_foreground_app()
            if current:
                key = (current["app"], current["title"])
                if key != last_key:
                    last_key = key
                    focus_started_at = time.time()
                    already_nudged_this_focus = False
                elif (
                    not already_nudged_this_focus
                    and current["app"].lower() not in _IGNORED_NUDGE_APPS
                    and time.time() - focus_started_at >= config.NUDGE_IDLE_SECONDS
                    and time.time() - last_nudge_at >= config.NUDGE_COOLDOWN_SECONDS
                ):
                    already_nudged_this_focus = True
                    last_nudge_at = time.time()
                    on_nudge(current)
        except Exception:
            pass
        time.sleep(ACTIVITY_POLL_SECONDS)


def start_nudge_watcher(on_nudge) -> None:
    threading.Thread(target=watch_for_nudges, args=(on_nudge,), daemon=True).start()
