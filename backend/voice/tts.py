import edge_tts

VOICE = "en-US-AriaNeural"


async def synthesize(text: str) -> bytes:
    """edge-tts is natively async, so this can be awaited directly from a
    FastAPI route with no thread offload needed."""
    communicate = edge_tts.Communicate(text, VOICE)
    chunks = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.extend(chunk["data"])
    return bytes(chunks)
