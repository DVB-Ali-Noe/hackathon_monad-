<script setup lang="ts">
const muted = useState('music-muted', () => false)
const audio = ref<HTMLAudioElement | null>(null)

// Les navigateurs bloquent le son avant une interaction : on retente au premier geste.
function play() {
  if (!audio.value) return
  audio.value.volume = 0.35
  void audio.value.play().catch(() => {})
}

onMounted(() => {
  play()
  window.addEventListener('pointerdown', play, { once: true })
  window.addEventListener('keydown', play, { once: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', play)
  window.removeEventListener('keydown', play)
})
</script>

<template>
  <NuxtPage />
  <audio ref="audio" src="/theme.mp3" loop preload="auto" :muted="muted" />
</template>
