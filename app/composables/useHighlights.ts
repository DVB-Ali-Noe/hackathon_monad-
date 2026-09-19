import type { Ref } from 'vue'

type Segment = { blob: Blob, seconds: number }

const CLIP_SECONDS = 15
const MIN_LAST_SECONDS = 5

// Le clip reste en mémoire dans le navigateur : aucune image n'est envoyée ni stockée.
export function useHighlights(video: Ref<HTMLVideoElement | null>, phase: Ref<string>) {
  const clip = ref('')
  let recorder: MediaRecorder | null = null
  let seconds = 0
  let last: Segment | null = null
  let before: Segment | null = null
  let session = 0
  let timer: ReturnType<typeof setInterval> | undefined

  function release() {
    if (clip.value) URL.revokeObjectURL(clip.value)
    clip.value = ''
  }

  function reset() {
    session++
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    recorder = null
    last = null
    before = null
    seconds = 0
    release()
  }

  function publish() {
    if (phase.value !== 'finished' || recorder || clip.value) return
    const pick = last && (last.seconds >= MIN_LAST_SECONDS || !before) ? last : before
    if (pick?.blob.size) clip.value = URL.createObjectURL(pick.blob)
  }

  function record() {
    const stream = video.value?.srcObject
    if (typeof MediaRecorder === 'undefined' || !(stream instanceof MediaStream) || !stream.active) return
    const mimeType = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
    const parts: Blob[] = []
    const owner = session
    let item: MediaRecorder
    try {
      item = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_000_000 })
    } catch { return }
    item.ondataavailable = (event) => { if (event.data.size) parts.push(event.data) }
    item.onstop = () => {
      item.onstop = null
      if (owner !== session) return
      const recorded = recorder === item ? seconds : CLIP_SECONDS
      if (recorder === item) recorder = null
      before = last
      last = { blob: new Blob(parts, { type: item.mimeType }), seconds: recorded }
      publish()
    }
    recorder = item
    seconds = 0
    item.start()
  }

  function tick() {
    if (recorder?.state !== 'recording' || ++seconds < CLIP_SECONDS) return
    const full = recorder
    record()
    full.stop()
  }

  watch(phase, (value) => {
    if (value === 'connecting' || value === 'setup') reset()
    else if (value === 'running') {
      if (recorder?.state === 'paused') recorder.resume()
      else if (!recorder) record()
    } else if (value === 'finished') {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else publish()
    } else if (recorder?.state === 'recording') recorder.pause()
  })

  onMounted(() => { timer = setInterval(tick, 1000) })
  onBeforeUnmount(() => {
    clearInterval(timer)
    reset()
  })

  return { clip }
}
