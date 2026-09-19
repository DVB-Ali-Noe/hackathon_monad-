import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const worker = (await readFile(new URL('../../public/pose.worker.js', import.meta.url), 'utf8'))
  .replace('await import(`${assetRoot}/vision_bundle.mjs`)', 'await self.loadVision()')

function environment(failure) {
  const delegates = []
  const messages = []
  let closed = 0
  const self = {
    postMessage: message => messages.push(message),
    async loadVision() {
      return {
        FilesetResolver: { forVisionTasks: async () => ({}) },
        PoseLandmarker: {
          async createFromOptions(files, options) {
            const delegate = options.baseOptions.delegate
            delegates.push(delegate)
            if (failure === 'loading' && delegate === 'GPU') throw new Error('GPU indisponible')
            return {
              detectForVideo() {
                if (failure === 'all' || (failure === 'inference' && delegate === 'GPU')) throw new Error('Inférence indisponible')
                return { landmarks: [[{ x: 0.5, y: 0.5, visibility: 1 }]] }
              },
              close() { closed++ },
            }
          },
        },
      }
    },
  }
  runInNewContext(worker, { self, performance })
  return { self, delegates, messages, get closed() { return closed } }
}

for (const failure of [null, 'loading', 'inference', 'all']) {
  test(`le worker gère le GPU et le repli CPU, cas ${failure ?? 'nominal'}`, async () => {
    const env = environment(failure)
    await env.self.onmessage({ data: { type: 'init' } })
    assert.equal(env.messages[0].type, 'ready')
    const bitmap = { closed: 0, close() { this.closed++ } }
    await env.self.onmessage({ data: { type: 'frame', timestamp: 100, bitmap } })
    assert.equal(bitmap.closed, 1)
    const result = env.messages.at(-1)
    assert.equal(result.type, failure === 'all' ? 'error' : 'pose')
    if (failure !== 'all') assert.equal(result.delegate, failure ? 'CPU' : 'GPU')
    assert.deepEqual(env.delegates, failure ? ['GPU', 'CPU'] : ['GPU'])
    if (failure === 'inference' || failure === 'all') assert.equal(env.closed, 1)
  })
}
