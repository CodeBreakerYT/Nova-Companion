# NOVA — Your Computer, Understood Naturally

**A personalized AI desktop companion, built for TechCommons Hacks V2: Hacks to Inspire.**

## The problem

Every computer today makes *you* adapt to *it*. You learn folder structures,
keyboard shortcuts, which app opens which file, where you buried that PDF
three weeks ago. It has no memory of your habits, no idea what you were just
doing, no way to just be *asked* for what you need — and every AI assistant
that tries to fix this is still just a chatbot in a browser tab, forgotten
the moment you alt-tab away. There's no continuity between "the thing I'm
working on" and "the thing that's supposed to be helping me."

## The idea

**Instead of learning how to use your computer, NOVA helps your computer
understand you.**

NOVA is a personalized desktop companion — a real, animated presence that
*lives on your desktop* (not a browser tab you forget about), watches what
you're actually doing (only what you allow, always visible and reviewable),
remembers your files and habits, and acts on your behalf through natural
conversation instead of menus. It's personalized in the literal sense: your
choice of character, your allowed folders, your notes and tasks, your
activity — all local, all yours.

Ask it to find your DBMS report. Ask it what you've been working on for the
last hour. Ask it to make a folder for tonight's submission, or help you plan
a study session, or just vent about a rough day — it's the same companion
either way, sitting right there on your screen instead of buried in a tab.

## What it actually does

- **Greets you and talks back** — on launch she generates and speaks a real
  opening line (Groq + edge-tts), not a canned string, and every reply is
  spoken out loud, not just text — voice is core, not a bolt-on.
- **Actually tracks your activity** — a background watcher polls the OS
  foreground window and logs real app/title changes; ask "what have I been
  working on?" and she answers from genuine data, not a guess. This is the
  actual "personalized" part: she has continuity with your day.
- **Checks in on her own** — she doesn't just answer, she notices. If you've
  been heads-down on the same window for a while with no chat activity, she
  proactively speaks up with a short, non-pushy offer to help (throttled so
  she's never naggy) — the difference between a companion and a chatbot
  that waits to be opened.
- **Is genuinely yours** — pick *any* VRM model as her body. Four sample
  characters ship pre-loaded (no upload needed to try it), or upload your
  own — VRM's standardized humanoid skeleton and expression presets mean the
  same pose/expression/lip-sync code drives whichever model you pick.
- **Lives on your desktop, not in a window** — click **▶ Play on Desktop**
  and a small, transparent, always-on-top window (she *is* the window, sized
  to her) sits on your screen over everything else. Drag her with a normal
  click-drag, hold **E** for a reaction, right-click for a menu (change
  character, resize, settings) — in sync with the main window in real time.
- **Has a face** — idle, listening, thinking, speaking, happy, confused,
  error — each with hand-authored procedural gestures layered on top of the
  breathing loop, plus random idle flourishes (look around, stretch,
  surprised) so she never looks frozen.
- **Finds your actual files** — a local full-text search index (SQLite FTS5)
  over your Documents/Downloads/Desktop (configurable, never the whole
  filesystem), surfaced as clickable result cards that really open the file.
  It also tracks what you copy in Explorer, so "where did I put the thing I
  just copied" works without a fresh search.
- **Takes safe, real actions** — opens files/folders, launches known apps,
  creates/edits documents, reads and writes code files (real coding help,
  not just advice), plays music, types text into whatever window has focus,
  opens URLs/web searches, saves notes and tasks. Every action goes through
  a fixed allowlist of validated tools; the LLM never gets shell or
  arbitrary-code access, and anything sensitive (creating files, writing
  code, typing into another window) asks for confirmation first.
- **Remembers, locally** — session conversation history, activity log,
  clipboard-file history, and lightweight preferences (allowed folders,
  chosen avatar, notes, tasks) — all local, with a one-click "Clear chat."
  Nothing leaves your machine except the text sent to Groq for reasoning.

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron — main chat window + a transparent, frameless, always-on-top companion window |
| Frontend | React + Vite + TypeScript, Zustand for state |
| 3D avatar | Three.js / React Three Fiber; default character is rigged FBX + Mixamo mocap, custom characters load via `@pixiv/three-vrm` (any VRM 0.x/1.0 model) — both driven by the same procedural bone-pose + expression system |
| Backend | Python + FastAPI, WebSocket for the live chat/avatar/tool loop, broadcasting avatar state to every connected window |
| LLM + tool calling | Groq (`openai/gpt-oss-120b`) |
| Speech-to-text | Groq-hosted Whisper (`whisper-large-v3-turbo`) |
| Text-to-speech | `edge-tts` |
| File search | SQLite FTS5, `pypdf` / `python-docx` text extraction |
| Packaging | PyInstaller (backend sidecar) + electron-builder (Windows installer) |

## Running it

```bash
# Backend
cd backend
uv venv --python 3.12 .venv
uv pip install -r requirements.txt --python .venv
cp ../.env.example ../.env   # add your GROQ_API_KEY

# Everything (frontend + Electron + backend, dev mode)
npm install
npm run dev
```

For the live demo, the proactive check-in (see step 2 below) waits 3 minutes
of continuous focus on one window by default — too long to show live. Start
with a short threshold instead:

```bash
NOVA_NUDGE_IDLE_SECONDS=25 NOVA_NUDGE_COOLDOWN_SECONDS=90 npm run dev
```

To build the standalone Windows app:

```bash
cd backend && .venv/Scripts/python.exe -m PyInstaller --name nova-backend --onedir --noconfirm --distpath dist --workpath build --specpath . main.py
cd .. && npm run dist
```

Output is a single portable exe, `dist/NOVA <version>.exe` — no installer,
just run it (also unpacked at `dist/win-unpacked/NOVA.exe`).

## Demo script (~3–4 minutes)

1. **Open NOVA.** She greets you out loud, unprompted — a real generated,
   spoken line, not a canned string. Avatar idles, breathing, occasional
   idle flourish (look around / stretch).
2. **"She works with you, not just for you"**: switch to a code editor or
   document (anything other than NOVA) and just talk to the audience for
   ~25–30 seconds without touching the keyboard/mouse — explain the problem
   statement while she watches quietly. She'll proactively speak up on her
   own, unprompted: *"Still on that? Let me know if you want a hand."* — no
   question was asked, no button was pressed. This is the moment that shows
   she's not a chatbot waiting to be opened; she notices and checks in like
   a real collaborator would. (Needs `NOVA_NUDGE_IDLE_SECONDS` set short per
   the run command above — real usage defaults to 3 minutes so she's never
   naggy.)
3. **Make her yours**: click **🎭 Character** — four sample characters are
   already there, no upload needed. Pick one and she's instantly different,
   same personality and skills. (Or right-click → Change Character →
   Upload VRM… for your own.)
4. **Bring her to the desktop**: click **▶ Play on Desktop** — a small,
   transparent, always-on-top window appears with just her standing in it,
   over your other apps. Drag her anywhere with a normal click-drag.
5. **Interact with her directly**: click her (a reaction), hold **E** for
   another, right-click for a menu — Change Character, Size…, Settings,
   Help, Quit — all from the desktop, no need to go back to the main window.
6. **Voice, spoken back**: hold the mic button, say *"Hey NOVA, how's it
   going?"* — she listens, thinks, replies out loud automatically — watch
   the companion window react in real time, in sync with the main window.
7. **"She actually knows what I've been doing"**: ask *"What have I been
   working on?"* — she answers from a real, live-tracked log of your recent
   foreground apps/windows, not a guess.
8. **File search + behavior memory**: copy a file in Explorer, then ask
   *"What did I just copy?"* — she recalls it from clipboard activity. Then
   *"Find my resume."* — real search hits, file cards appear, click **Open**.
9. **Desktop action with confirmation**: *"Create a folder called Hackathon
   Submission on my desktop."* — NOVA asks to confirm, click **Yes**, the
   folder is really created.
10. **Coding help**: *"Read my main.py and suggest one improvement"* — she
    reads the real file and responds based on its actual content.
11. **Productivity**: *"Add 'finish my slides' to my task list"* and *"Play
    some lofi music."*
12. Close on: *"NOVA — your computer, understood naturally."*

## Project structure

```
Nova-Companion/
  backend/
    main.py                # FastAPI app: WebSocket session (broadcasts to all windows) + REST endpoints
    config.py               # env, allowed dirs, model config
    seed_avatars/             # sample .vrm files, copied into the real avatars folder on first run
    ai/                      # Groq client + tool-calling agent loop + system prompt
    voice/                   # STT (Groq Whisper) + TTS (edge-tts)
    files/                    # SQLite FTS5 indexer + search
    tools/                     # allowlisted tool registry (files/apps/web/productivity/activity)
    memory/                     # preferences, notes, tasks, clipboard + foreground-window activity log
  frontend/
    src/App.tsx                   # main chat window
    src/CompanionView.tsx          # transparent desktop-companion window (?companion=1)
    src/components/avatar/          # NovaAvatar (default FBX), NovaVRMAvatar (any .vrm), AvatarPicker
    src/components/chat/             # chat panel, mic button
    src/components/files/             # file result cards
    src/store/, src/lib/                # Zustand store, WebSocket client, TTS playback
  electron/                              # main window + companion window + backend sidecar spawn
```
