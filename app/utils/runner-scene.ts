import * as THREE from 'three'
import type { RunnerFrame } from '../composables/useRunner'
import { createRunnerWorld } from './runner-world'

export function createRunnerScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const world = createRunnerWorld()
  function resize() {
    const { width, height } = canvas.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height, false)
    world.camera.aspect = width / height
    world.camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()
  return {
    assetsReady: world.loadTextures(),
    draw(frame: RunnerFrame) {
      world.update(frame)
      renderer.render(world.scene, world.camera)
    },
    dispose() {
      observer.disconnect()
      world.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
