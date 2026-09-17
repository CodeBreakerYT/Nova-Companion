import json
from typing import Any, Iterator

from groq import APIError, Groq

import config
from ai.prompts import SYSTEM_PROMPT
from tools.registry import execute_tool, get_tool_schemas, needs_confirmation

# Multi-step asks (find a file, read it, then act on it) can genuinely need
# more than a couple of tool calls — 3 was too tight and made longer chains
# (e.g. search -> search -> read_document) spill into the wrap-up call with
# no rounds left, which is exactly the scenario that triggers the
# tool_choice="none" crash handled below.
MAX_TOOL_ROUNDS = 6

_client: Groq | None = None


def get_client() -> Groq | None:
    """Lazily constructed so the app still boots (and can explain itself)
    with no API key configured."""
    global _client
    if not config.GROQ_API_KEY:
        return None
    if _client is None:
        _client = Groq(api_key=config.GROQ_API_KEY)
    return _client


def has_key() -> bool:
    return bool(config.GROQ_API_KEY)


def stream_reply(history: list[dict]) -> Iterator[str]:
    """history is a list of {"role": "user"|"assistant", "content": str},
    oldest first. Yields response text chunks as they arrive from Groq."""
    client = get_client()
    if client is None:
        yield "I don't have a Groq API key configured yet, so I can't think right now."
        return

    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]

    # Declare the tool schema but force tool_choice="none": omitting `tools`
    # entirely makes Groq hard-error ("Tool choice is none, but model called
    # a tool") if the model reaches for one anyway, and tool_choice="auto"
    # lets it silently emit a tool_call in the *streamed* response instead
    # of text — which we'd then read as an empty reply, since streamed
    # tool_call deltas aren't handled here. "none" is the only setting that
    # reliably guarantees real text back from a plain conversational turn.
    try:
        stream = client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=messages,
            tools=get_tool_schemas(),
            tool_choice="none",
            temperature=0.7,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except APIError:
        # The model can still insist on calling a tool even with
        # tool_choice="none" (Groq then hard-errors instead of ignoring it)
        # — this is a plain conversational turn with no tool-round loop
        # around it, so there's nowhere to actually run that tool; fall back
        # to a plain acknowledgement rather than an empty/failed reply.
        yield "Got it — let me know if you'd like me to look into anything specific."


def run_agent_turn(history: list[dict]) -> Iterator[dict[str, Any]]:
    """Groq tool-calling loop. Yields structured events as they happen:
    tool_call / tool_result (so the UI can show "Searching files..." and
    render file cards), needs_confirmation (stops the turn — see
    backend/main.py's pending-confirmation handling), token (streamed reply
    text), and final (the complete reply text).

    Tool-decision rounds are non-streaming (Groq's tool_call deltas aren't
    worth reassembling for a single-user desktop app); only the last,
    natural-language reply is streamed for the "typing" feel.
    """
    client = get_client()
    if client is None:
        text = "I don't have a Groq API key configured yet, so I can't think right now."
        yield {"type": "token", "text": text}
        yield {"type": "final", "text": text}
        return

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}, *history]
    tool_schemas = get_tool_schemas()

    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=messages,
            tools=tool_schemas,
            tool_choice="auto",
            temperature=0.5,
        )
        message = response.choices[0].message
        if not message.tool_calls:
            break

        messages.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in message.tool_calls
                ],
            }
        )

        stop_turn = False
        for tc in message.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}

            yield {"type": "tool_call", "tool": name, "args": args}

            if needs_confirmation(name):
                yield {
                    "type": "needs_confirmation",
                    "tool": name,
                    "args": args,
                    "message": f"Should I go ahead with {name.replace('_', ' ')}?",
                }
                stop_turn = True
                break

            result = execute_tool(name, args)
            yield {"type": "tool_result", "tool": name, "result": result}
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})

        if stop_turn:
            return
    else:
        pass  # exhausted rounds — fall through and let the model wrap up anyway

    # Same reasoning as stream_reply above: this is the wrap-up reply after
    # any tool rounds, so tool calls are explicitly turned off here —
    # "auto" let the model silently emit a tool_call instead of the
    # natural-language summary we actually need at this point.
    try:
        full_text = yield from _stream_wrapup(client, messages, tool_schemas)
    except APIError:
        # The model still insisted on calling a tool with tool_choice="none"
        # (Groq hard-errors rather than ignoring it) — most likely because it
        # genuinely wants to act on what it just read/found (e.g. type or
        # save something after read_document) and ran out of tool rounds to
        # do it in. Give it one bonus round to actually make that call for
        # real, then try the plain wrap-up again, instead of just failing.
        response = client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=messages,
            tools=tool_schemas,
            tool_choice="auto",
            temperature=0.5,
        )
        message = response.choices[0].message
        if message.tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        }
                        for tc in message.tool_calls
                    ],
                }
            )
            for tc in message.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                yield {"type": "tool_call", "tool": name, "args": args}
                if needs_confirmation(name):
                    yield {
                        "type": "needs_confirmation",
                        "tool": name,
                        "args": args,
                        "message": f"Should I go ahead with {name.replace('_', ' ')}?",
                    }
                    return
                result = execute_tool(name, args)
                yield {"type": "tool_result", "tool": name, "result": result}
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})
        try:
            full_text = yield from _stream_wrapup(client, messages, tool_schemas)
        except APIError:
            full_text = "Done with that — let me know if you'd like me to keep going."
            yield {"type": "token", "text": full_text}
    yield {"type": "final", "text": full_text}


def _stream_wrapup(client: Groq, messages: list[dict], tool_schemas: list[dict]) -> Iterator[dict[str, Any]]:
    """Shared by the normal path and the post-recovery retry in
    run_agent_turn — streams a plain-text reply and yields token events,
    returning (via StopIteration.value, i.e. `yield from`) the full text."""
    stream = client.chat.completions.create(
        model=config.GROQ_MODEL,
        messages=messages,
        tools=tool_schemas,
        tool_choice="none",
        temperature=0.7,
        stream=True,
    )
    full_text = ""
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            full_text += delta
            yield {"type": "token", "text": delta}
    return full_text
