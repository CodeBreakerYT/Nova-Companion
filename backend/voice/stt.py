from ai.groq import get_client

STT_MODEL = "whisper-large-v3-turbo"


def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Blocking call — Groq-hosted Whisper. Callers on an async event loop
    should run this via asyncio.to_thread."""
    client = get_client()
    if client is None:
        return ""

    result = client.audio.transcriptions.create(
        file=(filename, audio_bytes),
        model=STT_MODEL,
    )
    return (result.text or "").strip()
