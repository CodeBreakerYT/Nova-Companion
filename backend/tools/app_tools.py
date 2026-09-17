import os
import shutil
import subprocess
import time
import urllib.parse
import webbrowser

from pydantic import BaseModel, Field

from files.indexer import search_audio

# Allowlist only — the LLM names an app by common name, never a raw path or
# command line. Anything not in this map is refused rather than guessed at,
# so NOVA can never be tricked into launching an arbitrary executable.
KNOWN_APPS: dict[str, list[str]] = {
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe"],
    "explorer": ["explorer.exe"],
    "vs code": ["code"],
    "vscode": ["code"],
    "visual studio code": ["code"],
    "paint": ["mspaint.exe"],
    "task manager": ["taskmgr.exe"],
    "control panel": ["control.exe"],
    "cmd": ["cmd.exe"],
    "terminal": ["wt.exe", "cmd.exe"],
}


class LaunchApplicationArgs(BaseModel):
    name: str = Field(..., description="Common app name, e.g. 'notepad', 'vs code', 'calculator'")


def launch_application(args: LaunchApplicationArgs) -> dict:
    key = args.name.strip().lower()
    candidates = KNOWN_APPS.get(key)
    if not candidates:
        known = ", ".join(sorted({k for k in KNOWN_APPS}))
        return {"status": "error", "message": f"I don't have '{args.name}' in my known app list yet. I can open: {known}."}

    for exe in candidates:
        resolved = shutil.which(exe)
        if resolved:
            subprocess.Popen([resolved])  # noqa: S603 — resolved path comes only from the allowlist above
            return {"status": "ok", "message": f"Launching {args.name}."}
    return {"status": "error", "message": f"Couldn't find {args.name} installed on this machine."}


class PlayMusicArgs(BaseModel):
    query: str = Field(..., description="Song, artist, or vibe to play, e.g. 'lofi beats' or 'Blinding Lights'")


def play_music(args: PlayMusicArgs) -> dict:
    matches = search_audio(args.query)
    if matches:
        path = matches[0]["path"]
        os.startfile(path)  # noqa: S606 — path comes only from the local file index
        return {"status": "ok", "message": f"Playing {matches[0]['filename']} from your files."}
    # No local match — fall back to a YouTube search so the request still
    # does something real instead of silently failing.
    url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(args.query)
    webbrowser.open(url)
    return {"status": "ok", "message": f"Couldn't find '{args.query}' locally — opened a YouTube search instead."}


class TypeForMeArgs(BaseModel):
    text: str = Field(..., description="The exact text to type into whatever window currently has focus")


def type_for_me(args: TypeForMeArgs) -> dict:
    """Types into whichever window has OS focus at execution time — always
    gated behind a user confirmation (see tools/registry.py), plus a short
    delay after that confirmation so the user has a moment to click into
    the field they actually want it typed into."""
    import pyautogui

    time.sleep(2.5)
    pyautogui.write(args.text, interval=0.01)
    return {"status": "ok", "message": "Typed it."}
