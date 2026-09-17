import { useNovaStore } from '../store/nova-store'

let currentAudio: HTMLAudioElement | null = null

export async function speak(text: string) {
  if (!text.trim()) return

  const { setAvatarState, setTtsActive } = useNovaStore.getState()

  try {
    const res = await fetch('http://127.0.0.1:8765/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)

    currentAudio?.pause()
    const audio = new Audio(url)
    currentAudio = audio

    setTtsActive(true)
    setAvatarState('speaking')

    const cleanup = () => {
      URL.revokeObjectURL(url)
      setTtsActive(false)
      setAvatarState('idle')
    }
    audio.addEventListener('ended', cleanup, { once: true })
    audio.addEventListener('error', cleanup, { once: true })

    await audio.play()
  } catch {
    setTtsActive(false)
    setAvatarState('idle')
  }
}
