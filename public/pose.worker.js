// Worker classique : le chargeur WASM de MediaPipe utilise importScripts.
const assetRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21'
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
let landmarker
let delegate = 'GPU'
let createLandmarker

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      const { FilesetResolver, PoseLandmarker } = await import(`${assetRoot}/vision_bundle.mjs`)
      const files = await FilesetResolver.forVisionTasks(`${assetRoot}/wasm`)
      createLandmarker = delegate => PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
        outputSegmentationMasks: false,
      })
      try {
        landmarker = await createLandmarker('GPU')
      } catch {
        delegate = 'CPU'
        landmarker = await createLandmarker('CPU')
      }
      self.postMessage({ type: 'ready', delegate })
    } else if (data.type === 'frame') {
      try {
        const started = performance.now()
        let result
        try {
          result = landmarker.detectForVideo(data.bitmap, data.timestamp)
        } catch (error) {
          if (delegate !== 'GPU') throw error
          landmarker.close()
          delegate = 'CPU'
          landmarker = await createLandmarker('CPU')
          result = landmarker.detectForVideo(data.bitmap, data.timestamp)
        }
        self.postMessage({
          type: 'pose', landmarks: result.landmarks[0] ?? [],
          timestamp: data.timestamp, inferenceMs: performance.now() - started, delegate,
        })
      } finally {
        data.bitmap.close()
      }
    }
  } catch {
    self.postMessage({ type: 'error', stage: data.type === 'init' ? 'loading' : 'inference' })
  }
}
