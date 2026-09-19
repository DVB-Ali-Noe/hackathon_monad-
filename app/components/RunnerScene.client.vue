<script setup lang="ts">
import type { RunnerFrame } from '../composables/useRunner'

const props = defineProps<{ advance: (time: number) => RunnerFrame }>()
const emit = defineEmits<{ ready: [], error: [message: string], textures: [loaded: boolean] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let scene: Awaited<ReturnType<typeof import('../utils/runner-scene')['createRunnerScene']>> | null = null
let animation = 0
let disposed = false

function lost(event: Event) {
  event.preventDefault()
  cancelAnimationFrame(animation)
  emit('error', 'Le rendu 3D a été interrompu. Recharge la page pour reprendre.')
}

onMounted(async () => {
  try {
    const { createRunnerScene } = await import('../utils/runner-scene')
    if (disposed || !canvas.value) return
    scene = createRunnerScene(canvas.value)
    void scene.assetsReady.then((loaded) => { if (!disposed) emit('textures', loaded) })
    canvas.value.addEventListener('webglcontextlost', lost)
    emit('ready')
    function render(time: number) {
      if (disposed || !scene) return
      try {
        scene.draw(props.advance(time))
        animation = requestAnimationFrame(render)
      } catch {
        emit('error', 'Le rendu 3D a été interrompu. Recharge la page pour réessayer.')
      }
    }
    animation = requestAnimationFrame(render)
  } catch {
    emit('error', 'Le rendu 3D est indisponible. Vérifie que WebGL est activé dans un navigateur récent.')
  }
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(animation)
  canvas.value?.removeEventListener('webglcontextlost', lost)
  scene?.dispose()
})
</script>

<template>
  <canvas ref="canvas" class="block size-full" aria-label="Piste de course à trois rails avec trains, rampes, obstacles et pièces" />
</template>
