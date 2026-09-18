from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel

from tools.activity_tools import RecentActivityArgs, recent_activity
from tools.app_tools import (
    LaunchApplicationArgs,
    PlayMusicArgs,
    TypeForMeArgs,
    launch_application,
    play_music,
    type_for_me,
)
from tools.file_tools import (
    CreateFolderArgs,
    EditDocumentArgs,
    OpenFileArgs,
    OpenFolderArgs,
    ReadCodeFileArgs,
    ReadDocumentArgs,
    RecentFilesArgs,
    SearchFilesArgs,
    WriteCodeFileArgs,
    create_folder,
    edit_document,
    open_file,
    open_folder,
    read_code_file,
    read_document,
    recent_files,
    search_files,
    write_code_file,
)
from tools.productivity_tools import CreateNoteArgs, CreateTaskArgs, create_note, create_task
from tools.screen_tools import ReadScreenTextArgs, read_screen_text
from tools.web_tools import OpenUrlArgs, WebSearchArgs, open_url, web_search


@dataclass
class ToolSpec:
    description: str
    args_model: type[BaseModel]
    handler: Callable[[BaseModel], dict]
    needs_confirmation: bool = False


# The only actions the LLM can ever trigger — every tool call from Groq is
# validated against this fixed allowlist and its pydantic argument schema
# before anything touches the filesystem or launches a process.
TOOLS: dict[str, ToolSpec] = {
    "search_files": ToolSpec(
        "Search the user's local files (in their allowed folders) by name or content.",
        SearchFilesArgs,
        search_files,
    ),
    "open_file": ToolSpec(
        "Open a specific file (by full path, usually from a prior search_files result) with its default app.",
        OpenFileArgs,
        open_file,
    ),
    "open_folder": ToolSpec(
        "Open a folder in the file explorer.",
        OpenFolderArgs,
        open_folder,
    ),
    "create_folder": ToolSpec(
        "Create a new folder inside one of the user's allowed directories.",
        CreateFolderArgs,
        create_folder,
        needs_confirmation=True,
    ),
    "launch_application": ToolSpec(
        "Launch a known desktop application by common name (e.g. 'notepad', 'vs code').",
        LaunchApplicationArgs,
        launch_application,
    ),
    "open_url": ToolSpec(
        "Open a specific URL in the user's default web browser.",
        OpenUrlArgs,
        open_url,
    ),
    "web_search": ToolSpec(
        "Search the web for something and open the results in the browser.",
        WebSearchArgs,
        web_search,
    ),
    "create_note": ToolSpec(
        "Save a short freeform note for the user.",
        CreateNoteArgs,
        create_note,
    ),
    "create_task": ToolSpec(
        "Add an item to the user's task/to-do list.",
        CreateTaskArgs,
        create_task,
    ),
    "recent_files": ToolSpec(
        "List files the user recently copied (in Explorer) or that NOVA recently opened — "
        "use this for 'where did I put the thing I just copied' style questions.",
        RecentFilesArgs,
        recent_files,
    ),
    "edit_document": ToolSpec(
        "Add text to an existing .txt, .md, or .docx document, or overwrite it.",
        EditDocumentArgs,
        edit_document,
        needs_confirmation=True,
    ),
    "read_code_file": ToolSpec(
        "Read the contents of a source code file to help the user with it.",
        ReadCodeFileArgs,
        read_code_file,
    ),
    "read_document": ToolSpec(
        "Read the real text content of a .txt, .md, .pdf, or .docx document (e.g. a resume or report) — "
        "use this before drafting anything based on a document's actual details, not just its filename.",
        ReadDocumentArgs,
        read_document,
    ),
    "write_code_file": ToolSpec(
        "Write (create or overwrite) a source code file with new content.",
        WriteCodeFileArgs,
        write_code_file,
        needs_confirmation=True,
    ),
    "play_music": ToolSpec(
        "Play a song by name/artist — tries the user's local music files first, "
        "falls back to opening a YouTube search.",
        PlayMusicArgs,
        play_music,
    ),
    "type_for_me": ToolSpec(
        "Type exact text into whatever window currently has focus on the user's screen "
        "(e.g. dictating into a form or chat box). The user gets a few seconds after "
        "confirming to click into the right field first.",
        TypeForMeArgs,
        type_for_me,
        needs_confirmation=True,
    ),
    "read_screen_text": ToolSpec(
        "Read the real text content of whatever window the user currently has focused — not a screenshot, the "
        "actual text via accessibility APIs. Use this when the user asks what's on their screen, wants help with "
        "what they're currently writing, or asks you to continue/edit/review something without pasting it in.",
        ReadScreenTextArgs,
        read_screen_text,
    ),
    "recent_activity": ToolSpec(
        "See what apps/windows the user has actually had focused recently, most recent first — "
        "use this for 'what have I been working on' or to notice they've been stuck on one thing a while.",
        RecentActivityArgs,
        recent_activity,
    ),
}


def get_tool_schemas() -> list[dict[str, Any]]:
    schemas = []
    for name, spec in TOOLS.items():
        schema = spec.args_model.model_json_schema()
        schema.pop("title", None)
        schemas.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": spec.description,
                    "parameters": schema,
                },
            }
        )
    return schemas


def needs_confirmation(name: str) -> bool:
    spec = TOOLS.get(name)
    return bool(spec and spec.needs_confirmation)


def execute_tool(name: str, arguments: dict) -> dict:
    spec = TOOLS.get(name)
    if spec is None:
        return {"status": "error", "message": f"Unknown tool '{name}'."}
    try:
        parsed_args = spec.args_model.model_validate(arguments)
    except Exception as e:
        return {"status": "error", "message": f"Invalid arguments for {name}: {e}"}
    try:
        return spec.handler(parsed_args)
    except Exception as e:
        return {"status": "error", "message": f"{name} failed: {e}"}
