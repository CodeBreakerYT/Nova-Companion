import asyncio
import os
import queue
import subprocess
import threading
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

import config
from ai.groq import run_agent_turn, stream_reply
from files.indexer import index_count, rescan, search as search_files_index
from memory.activity import record_path, start_activity_watcher, start_clipboard_watcher, start_nudge_watcher
from memory.store import add_allowed_dir, get_allowed_dirs, get_avatar_model, load_tasks, set_avatar_model
from tools.file_tools import is_within_allowed
from tools.registry import execute_tool
from voice.stt import transcribe
from voice.tts import synthesize

AVATARS_DIR = config.DATA_DIR / "avatars"
AVATARS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="NOVA Backend")

# The Electron renderer loads from a file:// / localhost Vite dev origin;
# CORS is wide open here because this server only ever binds to 127.0.0.1
# and is never exposed beyond the local machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_HISTORY_TURNS = 20


def _seed_avatars() -> None:
    """Copies any bundled sample .vrm files into the real avatars folder on
    first run, so there's something to showcase in the Character picker
    without requiring a manual upload first."""
    if not config.SEED_AVATARS_DIR.exists():
        return
    for src in config.SEED_AVATARS_DIR.glob("*.vrm"):
        dest = AVATARS_DIR / src.name
        if not dest.exists():
            dest.write_bytes(src.read_bytes())


@app.on_event("startup")
def _initial_index() -> None:
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_event_loop()
    _seed_avatars()
    # Runs in a background thread so a large Documents folder doesn't delay
    # the app's first health check / window paint.
    threading.Thread(target=rescan, daemon=True).start()
    start_clipboard_watcher()
    start_activity_watcher()
    start_nudge_watcher(_on_nudge)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "groq_configured": bool(config.GROQ_API_KEY),
        "model": config.GROQ_MODEL,
    }


@app.post("/api/stt")
async def stt(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(400, "empty audio")
    text = await asyncio.to_thread(transcribe, audio_bytes, audio.filename or "audio.webm")
    return {"text": text}


@app.post("/api/tts")
async def tts(payload: dict):
    text = (payload.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "empty text")
    audio_bytes = await synthesize(text)
    return Response(content=audio_bytes, media_type="audio/mpeg")


@app.get("/api/index/search")
async def index_search(q: str):
    return {"results": await asyncio.to_thread(search_files_index, q)}


@app.post("/api/index/rescan")
async def index_rescan():
    count = await asyncio.to_thread(rescan)
    return {"indexed": count}


@app.get("/api/index/status")
async def index_status():
    return {"indexed": await asyncio.to_thread(index_count), "allowed_dirs": get_allowed_dirs()}


@app.post("/api/index/allowed-dirs")
async def index_add_dir(payload: dict):
    path = (payload.get("path") or "").strip()
    if not path:
        raise HTTPException(400, "path required")
    return {"allowed_dirs": add_allowed_dir(path)}


@app.post("/api/files/open")
async def files_open(payload: dict):
    path = (payload.get("path") or "").strip()
    if not is_within_allowed(path):
        raise HTTPException(403, "path outside allowed folders")
    os.startfile(path)  # noqa: S606 — validated against the allowlist above
    record_path(path)
    return {"status": "ok"}


@app.post("/api/files/reveal")
async def files_reveal(payload: dict):
    path = (payload.get("path") or "").strip()
    if not is_within_allowed(path):
        raise HTTPException(403, "path outside allowed folders")
    subprocess.run(["explorer", "/select,", path])  # noqa: S603, S607 — validated path only
    return {"status": "ok"}


@app.get("/api/tasks")
async def tasks_list():
    return {"tasks": load_tasks()}


def _safe_avatar_path(filename: str) -> Path:
    """Rejects anything that isn't a plain filename inside AVATARS_DIR —
    blocks path traversal (e.g. '../../whatever') from a crafted filename."""
    path = (AVATARS_DIR / filename).resolve()
    if path.parent != AVATARS_DIR.resolve() or not filename:
        raise HTTPException(400, "invalid filename")
    return path


@app.get("/api/avatar/list")
async def avatar_list():
    avatars = [p.name for p in AVATARS_DIR.glob("*.vrm")]
    active = get_avatar_model()
    if active is not None and active not in avatars:
        # The saved selection points at a file that's no longer there (e.g.
        # a seed avatar got renamed/removed in an update) — silently falling
        # back to the default character beats trying to load a 404'd model
        # and leaving the avatar viewport blank with no visible error.
        active = None
        set_avatar_model(None)
    return {"avatars": avatars, "active": active}


@app.post("/api/avatar/upload")
async def avatar_upload(file: UploadFile = File(...)):
    if not (file.filename or "").lower().endswith(".vrm"):
        raise HTTPException(400, "only .vrm files are supported")
    dest = _safe_avatar_path(file.filename)
    dest.write_bytes(await file.read())
    set_avatar_model(dest.name)
    return {"status": "ok", "filename": dest.name}


@app.post("/api/avatar/select")
async def avatar_select(payload: dict):
    filename = payload.get("filename")
    if filename is not None:
        _safe_avatar_path(filename)  # validates it's a real file in the avatars dir
        if not (AVATARS_DIR / filename).exists():
            raise HTTPException(404, "avatar not found")
    set_avatar_model(filename)
    return {"status": "ok", "active": filename}


@app.get("/api/avatar/file/{filename}")
async def avatar_file(filename: str):
    path = _safe_avatar_path(filename)
    if not path.exists():
        raise HTTPException(404, "avatar not found")
    return FileResponse(path, media_type="model/gltf-binary")


def _agent_turn_in_thread(history: list[dict], out_queue: "queue.Queue[dict | None]") -> None:
    """Runs on a worker thread — the Groq calls inside run_agent_turn are
    synchronous, so consuming it here keeps the WebSocket's event loop free
    to handle other messages (e.g. a confirmation reply) while it works."""
    try:
        for event in run_agent_turn(history):
            out_queue.put(event)
    finally:
        out_queue.put(None)  # sentinel: turn finished (or paused on a confirmation)


def _run_turn_and_stream_history(history: list[dict], out_queue: "queue.Queue[dict | None]") -> None:
    try:
        full_text = ""
        for chunk in stream_reply(history):
            full_text += chunk
            out_queue.put({"type": "token", "text": chunk})
        out_queue.put({"type": "final", "text": full_text})
    finally:
        out_queue.put(None)


CONNECTED_SESSIONS: set[WebSocket] = set()
HAS_GREETED = False  # once per backend process lifetime, not per window/connection
MAIN_LOOP: asyncio.AbstractEventLoop | None = None
LAST_NUDGE_TEXT: str | None = None  # so whichever window the user replies in has context


def _on_nudge(current: dict) -> None:
    """Called from the nudge-watcher background thread (not the event loop) —
    hands off to the async broadcaster on the app's own event loop."""
    if not CONNECTED_SESSIONS or MAIN_LOOP is None:
        return
    asyncio.run_coroutine_threadsafe(_speak_nudge(current), MAIN_LOOP)


async def _speak_nudge(current: dict) -> None:
    global LAST_NUDGE_TEXT
    nudge_history = [
        {
            "role": "system",
            "content": (
                f"The user has had '{current['title']}' open in {current['app']} for a while without asking you "
                "anything. Proactively check in with ONE short, natural, non-pushy sentence offering help — don't "
                "guess specifics you don't actually know, just offer generally (e.g. 'Still on that? Let me know "
                "if you want a hand.'). Don't mention that you're tracking their activity."
            ),
        }
    ]
    out_queue: "queue.Queue[dict | None]" = queue.Queue()
    thread = threading.Thread(target=_run_turn_and_stream_history, args=(nudge_history, out_queue), daemon=True)
    thread.start()
    full_reply = ""
    while True:
        event = await MAIN_LOOP.run_in_executor(None, out_queue.get)  # type: ignore[union-attr]
        if event is None:
            break
        if event["type"] == "final":
            full_reply = event["text"]
    if not full_reply:
        return
    LAST_NUDGE_TEXT = full_reply
    await broadcast_avatar_state("speaking")
    dead = []
    for client in CONNECTED_SESSIONS:
        try:
            await client.send_json({"type": "proactive_message", "text": full_reply})
        except Exception:
            dead.append(client)
    for d in dead:
        CONNECTED_SESSIONS.discard(d)
    await broadcast_avatar_state("idle")


SHARED_HISTORY: list[dict] = []
PENDING_CONFIRMATION: dict | None = None


async def broadcast_to_others(exclude: WebSocket, payload: dict) -> None:
    """Same fan-out as broadcast_avatar_state, but skips the connection that
    triggered the turn — that one already got the full experience (streamed
    tokens, spoken reply) through its own request/response, so re-sending it
    the final text would just make it speak the same reply twice."""
    dead = []
    for client in CONNECTED_SESSIONS:
        if client is exclude:
            continue
        try:
            await client.send_json(payload)
        except Exception:
            dead.append(client)
    for d in dead:
        CONNECTED_SESSIONS.discard(d)


async def broadcast_avatar_state(state: str) -> None:
    """Pushed to every open session — not just the one that triggered it —
    so the transparent desktop-companion window (its own WebSocket
    connection, see /?companion=1) stays in sync with whatever the main
    chat window is doing."""
    dead = []
    for client in CONNECTED_SESSIONS:
        try:
            await client.send_json({"type": "avatar_state", "state": state})
        except Exception:
            dead.append(client)
    for d in dead:
        CONNECTED_SESSIONS.discard(d)


@app.websocket("/ws/session")
async def session(ws: WebSocket):
    await ws.accept()
    CONNECTED_SESSIONS.add(ws)
    # One shared conversation (SHARED_HISTORY / PENDING_CONFIRMATION, both
    # module-level) across every connected window — the main chat window
    # and the desktop companion used to each keep their own local history,
    # so a voice exchange through the companion was invisible to the main
    # window's chat log and vice versa. Now every window reads/writes the
    # same memory; only the streamed "typing" experience and TTS playback
    # stay per-window (see broadcast_to_others below), so a reply doesn't
    # get spoken twice.
    #
    # PENDING_CONFIRMATION is reassigned from several branches below —
    # Python requires the `global` declaration to appear exactly once, before
    # any reference to the name anywhere in the function (repeating it in
    # each branch is a SyntaxError, not just redundant).
    global PENDING_CONFIRMATION
    loop = asyncio.get_event_loop()

    async def drain_events(out_queue: "queue.Queue[dict | None]") -> str:
        """Pumps events from the worker thread to the client, tracking
        avatar state and the accumulated reply text as it goes."""
        full_reply = ""
        sent_speaking = False
        while True:
            event = await loop.run_in_executor(None, out_queue.get)
            if event is None:
                break

            etype = event["type"]
            if etype == "tool_call":
                await ws.send_json({"type": "tool_call", "tool": event["tool"], "args": event["args"]})
            elif etype == "tool_result":
                await ws.send_json({"type": "tool_result", "tool": event["tool"], "result": event["result"]})
                result = event["result"]
                if result.get("status") == "error":
                    await broadcast_avatar_state("confused")
                elif event["tool"] == "search_files" and result.get("count", 0) > 0:
                    await broadcast_avatar_state("happy")
            elif etype == "needs_confirmation":
                global PENDING_CONFIRMATION
                PENDING_CONFIRMATION = {"tool": event["tool"], "args": event["args"]}
                # Broadcast, not just to this connection — a confirmation
                # triggered by a voice request through the companion (which
                # has no confirm UI of its own) needs to be answerable from
                # the main window instead of being stranded nowhere.
                confirm_payload = {
                    "type": "confirm_required",
                    "tool": event["tool"],
                    "args": event["args"],
                    "message": event["message"],
                }
                await ws.send_json(confirm_payload)
                await broadcast_to_others(ws, confirm_payload)
            elif etype == "token":
                if not sent_speaking:
                    await broadcast_avatar_state("speaking")
                    sent_speaking = True
                full_reply += event["text"]
                await ws.send_json({"type": "token", "text": event["text"]})
            elif etype == "final":
                full_reply = event["text"]
        return full_reply

    try:
        while True:
            payload = await ws.receive_json()
            ptype = payload.get("type")

            if ptype == "greet":
                # Fires once per backend process, not once per window — both
                # the main chat window and the desktop companion request it
                # on load, but only the first one should actually get a
                # spoken reply out of it.
                global HAS_GREETED
                if HAS_GREETED:
                    continue
                HAS_GREETED = True

                SHARED_HISTORY.append(
                    {
                        "role": "system",
                        "content": "NOVA just started up and the user is about to see you for the first time this "
                        "session. Greet them warmly in one short, natural sentence — no need to ask what they need "
                        "unless it flows naturally.",
                    }
                )
                await broadcast_avatar_state("thinking")
                out_queue: "queue.Queue[dict | None]" = queue.Queue()
                thread = threading.Thread(
                    target=_run_turn_and_stream_history, args=(SHARED_HISTORY, out_queue), daemon=True
                )
                thread.start()
                full_reply = await drain_events(out_queue) or "Hey! Good to see you."
                SHARED_HISTORY.append({"role": "assistant", "content": full_reply})
                await ws.send_json({"type": "final_message", "text": full_reply, "greeting": True})
                await broadcast_to_others(ws, {"type": "remote_turn", "assistant_text": full_reply})
                await broadcast_avatar_state("idle")
                continue

            if ptype == "clear_history":
                SHARED_HISTORY.clear()
                PENDING_CONFIRMATION = None
                await broadcast_avatar_state("idle")
                continue

            if ptype == "tool_confirm":
                if PENDING_CONFIRMATION is None:
                    continue
                tool, args = PENDING_CONFIRMATION["tool"], PENDING_CONFIRMATION["args"]
                PENDING_CONFIRMATION = None
                approved = bool(payload.get("approved"))

                await broadcast_avatar_state("thinking")
                if approved:
                    result = await asyncio.to_thread(execute_tool, tool, args)
                    await ws.send_json({"type": "tool_result", "tool": tool, "result": result})
                    note = f"The user approved '{tool}' with {args}. Result: {result}. Confirm what happened in one short, natural sentence."
                else:
                    note = f"The user declined '{tool}'. Acknowledge that briefly and naturally."
                SHARED_HISTORY.append({"role": "system", "content": note})

                out_queue: "queue.Queue[dict | None]" = queue.Queue()
                thread = threading.Thread(
                    target=_run_turn_and_stream_history, args=(SHARED_HISTORY, out_queue), daemon=True
                )
                thread.start()
                full_reply = await drain_events(out_queue) or "Done — let me know if you need anything else."

                SHARED_HISTORY.append({"role": "assistant", "content": full_reply})
                SHARED_HISTORY[:] = SHARED_HISTORY[-MAX_HISTORY_TURNS * 2 :]
                await ws.send_json({"type": "final_message", "text": full_reply})
                await broadcast_to_others(ws, {"type": "remote_turn", "assistant_text": full_reply})
                await broadcast_avatar_state("idle")
                continue

            if ptype != "user_message":
                continue

            text = (payload.get("text") or "").strip()
            if not text:
                continue

            PENDING_CONFIRMATION = None
            global LAST_NUDGE_TEXT
            if LAST_NUDGE_TEXT is not None:
                SHARED_HISTORY.append(
                    {
                        "role": "system",
                        "content": f"(For context: you just proactively said to the user: \"{LAST_NUDGE_TEXT}\")",
                    }
                )
                LAST_NUDGE_TEXT = None
            SHARED_HISTORY.append({"role": "user", "content": text})
            # Other windows won't stream this turn's tokens (only the
            # originating connection does), but their chat panels should
            # still show the user's side of the conversation right away
            # rather than waiting for — or never getting — the reply.
            await broadcast_to_others(ws, {"type": "remote_turn", "user_text": text})
            await broadcast_avatar_state("thinking")

            out_queue = queue.Queue()
            thread = threading.Thread(target=_agent_turn_in_thread, args=(SHARED_HISTORY, out_queue), daemon=True)
            thread.start()
            full_reply = await drain_events(out_queue)

            if PENDING_CONFIRMATION is not None:
                # Turn paused waiting on the user's yes/no — nothing to
                # finalize yet, and no assistant turn to record in history.
                continue

            full_reply = full_reply or "Sorry, I hit a snag processing that — could you try again?"
            SHARED_HISTORY.append({"role": "assistant", "content": full_reply})
            SHARED_HISTORY[:] = SHARED_HISTORY[-MAX_HISTORY_TURNS * 2 :]
            await ws.send_json({"type": "final_message", "text": full_reply})
            await broadcast_to_others(ws, {"type": "remote_turn", "assistant_text": full_reply})
            await broadcast_avatar_state("idle")
    except WebSocketDisconnect:
        pass
    finally:
        CONNECTED_SESSIONS.discard(ws)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
