import json
from typing import Any

import config

PREFS_PATH = config.DATA_DIR / "preferences.json"
NOTES_PATH = config.DATA_DIR / "notes.md"
TASKS_PATH = config.DATA_DIR / "tasks.json"

_DEFAULT_PREFS = {
    "preferred_name": "",
    "allowed_dirs": config.DEFAULT_ALLOWED_DIRS,
    "avatar_model": None,  # filename under memory/data/avatars/, or None for the default character
}


def load_preferences() -> dict[str, Any]:
    if not PREFS_PATH.exists():
        save_preferences(_DEFAULT_PREFS)
        return dict(_DEFAULT_PREFS)
    try:
        return {**_DEFAULT_PREFS, **json.loads(PREFS_PATH.read_text(encoding="utf-8"))}
    except (json.JSONDecodeError, OSError):
        return dict(_DEFAULT_PREFS)


def save_preferences(prefs: dict[str, Any]) -> None:
    PREFS_PATH.write_text(json.dumps(prefs, indent=2), encoding="utf-8")


def get_allowed_dirs() -> list[str]:
    return load_preferences().get("allowed_dirs", config.DEFAULT_ALLOWED_DIRS)


def add_allowed_dir(path: str) -> list[str]:
    prefs = load_preferences()
    dirs = prefs.get("allowed_dirs", [])
    if path not in dirs:
        dirs.append(path)
    prefs["allowed_dirs"] = dirs
    save_preferences(prefs)
    return dirs


def append_note(text: str) -> None:
    import datetime

    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    with NOTES_PATH.open("a", encoding="utf-8") as f:
        f.write(f"## {stamp}\n{text}\n\n")


def load_tasks() -> list[dict[str, Any]]:
    if not TASKS_PATH.exists():
        return []
    try:
        return json.loads(TASKS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def add_task(text: str) -> list[dict[str, Any]]:
    tasks = load_tasks()
    tasks.append({"text": text, "done": False})
    TASKS_PATH.write_text(json.dumps(tasks, indent=2), encoding="utf-8")
    return tasks


def get_avatar_model() -> str | None:
    return load_preferences().get("avatar_model")


def set_avatar_model(filename: str | None) -> None:
    prefs = load_preferences()
    prefs["avatar_model"] = filename
    save_preferences(prefs)
