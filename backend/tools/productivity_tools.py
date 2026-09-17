from pydantic import BaseModel, Field

from memory.store import add_task, append_note


class CreateNoteArgs(BaseModel):
    text: str = Field(..., description="The note content to save")


def create_note(args: CreateNoteArgs) -> dict:
    append_note(args.text)
    return {"status": "ok", "message": "Saved that as a note."}


class CreateTaskArgs(BaseModel):
    text: str = Field(..., description="A short task/to-do description")


def create_task(args: CreateTaskArgs) -> dict:
    tasks = add_task(args.text)
    return {"status": "ok", "message": f"Added to your task list ({len(tasks)} total).", "tasks": tasks}
