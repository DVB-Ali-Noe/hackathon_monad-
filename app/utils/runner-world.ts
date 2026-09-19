import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { LANE_WIDTH, RAMP_LENGTH, TRAIN_HEIGHT, TRAIN_LENGTH, BARRIER_HEIGHT, itemDistance, itemLength } from '#shared/game/engine.ts'
import type { GameState, TrackItem } from '#shared/game/engine.ts'
import type { RunnerFrame } from '../composables/useRunner'

export function createRunnerWorld() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#83d3f1')
  scene.fog = new THREE.Fog('#b9e5eb', 65, 140)
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 180)
  scene.add(new THREE.HemisphereLight(0xe7f9ff, 0xb69b78, 1.7))
  const sun = new THREE.DirectionalLight(0xfff0cc, 1.6)
  sun.position.set(-8, 16, 8)
  scene.add(sun)

  const cube = new THREE.BoxGeometry(1, 1, 1)
  const rounded = new RoundedBoxGeometry(1, 1, 1, 2, 0.12)
  const sphere = new THREE.SphereGeometry(1, 12, 8)
  const textures: THREE.Texture[] = []
  let disposed = false
  function texture(draw: (context: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    draw(canvas.getContext('2d')!)
    const map = new THREE.CanvasTexture(canvas)
    map.colorSpace = THREE.SRGBColorSpace
    textures.push(map)
    return map
  }
  const brick = texture((ctx) => {
    ctx.fillStyle = '#efaf82'
    ctx.fillRect(0, 0, 256, 256)
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 4; col++) {
        ctx.fillStyle = ['#d87e59', '#cd7051', '#e28b62'][(row + col + 3) % 3]!
        ctx.fillRect(col * 86 + row % 2 * 43 + 2, row * 32 + 2, 82, 28)
      }
    }
  })
  brick.wrapS = brick.wrapT = THREE.RepeatWrapping
  brick.repeat.set(35, 1)
  const stripes = texture((ctx) => {
    ctx.fillStyle = '#fff7db'
    ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#ed4b42'
    for (let x = -256; x < 512; x += 100) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 50, 0)
      ctx.lineTo(x - 90, 256)
      ctx.lineTo(x - 140, 256)
      ctx.fill()
    }
  })
  const badge = texture((ctx) => {
    ctx.fillStyle = '#214e72'
    ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#ffdc53'
    ctx.font = '900 176px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('M', 128, 191)
  })
  const graffiti = texture((ctx) => {
    ctx.fillStyle = '#20536d'
    ctx.fillRect(0, 0, 256, 256)
    ctx.translate(128, 128)
    ctx.rotate(-0.12)
    ctx.font = '900 62px Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.lineWidth = 12
    ctx.strokeStyle = '#173d60'
    ctx.strokeText('MONAD', 0, -3)
    ctx.strokeText('BLITZ', 0, 66)
    ctx.fillStyle = '#fff6d3'
    ctx.fillText('MONAD', 0, -3)
    ctx.fillStyle = '#ffca3a'
    ctx.fillText('BLITZ', 0, 66)
  })
  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color })
  const materials = {
    ballast: lambert(0xbba996), ties: lambert(0x7b665a), rail: lambert(0x859aaa),
    pavement: lambert(0xefd6b5), white: lambert(0xfff5df), roof: lambert(0xd6e3e4),
    colored: lambert(0xffffff), glass: lambert(0x235879), trim: lambert(0x316c9b),
    train: lambert(0xffffff), track: lambert(0xbba996),
    red: lambert(0xe64f40), brown: lambert(0x9b6b3e), green: lambert(0x69b958), dark: lambert(0x334754),
    brick: new THREE.MeshLambertMaterial({ map: brick }),
    stripes: new THREE.MeshLambertMaterial({ map: stripes }),
    badge: new THREE.MeshBasicMaterial({ map: badge }),
    graffiti: new THREE.MeshBasicMaterial({ map: graffiti, side: THREE.DoubleSide }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffca32, metalness: 0.5, roughness: 0.28 }),
    goldRim: new THREE.MeshBasicMaterial({ color: 0xffef8a }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff2ba }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x243c42, transparent: true, opacity: 0.16, depthWrite: false }),
  }
  function mesh(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, geometry: THREE.BufferGeometry = cube) {
    const object = new THREE.Mesh(geometry, material)
    object.position.set(x, y, z)
    object.scale.set(sx, sy, sz)
    return object
  }
  scene.add(mesh(materials.ballast, 0, -0.19, -60, 8.6, 0.35, 160))
  for (const side of [-1, 1]) {
    scene.add(mesh(materials.pavement, side * 6.6, -0.18, -60, 4.5, 0.4, 160))
    const wall = mesh(materials.brick, side * 4.65, 0.8, -60, 160, 1.6, 0.3)
    wall.rotation.y = Math.PI / 2
    scene.add(wall, mesh(materials.pavement, side * 4.65, 1.65, -60, 0.5, 0.15, 160))
  }
  for (const lane of [-1, 0, 1]) {
    const track = mesh(materials.track, lane * 2.4, -0.005, -60, 2.2, 160, 1, new THREE.PlaneGeometry(1, 1))
    track.rotation.x = -Math.PI / 2
    scene.add(track)
    for (const side of [-1, 1]) scene.add(mesh(materials.rail, lane * 2.4 + side * 0.76, 0.065, -60, 0.075, 0.12, 160))
  }

  const wedge = new THREE.BufferGeometry()
  wedge.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 1, -0.5, 0.5, 1, -0.5,
  ], 3))
  wedge.setIndex([0, 1, 5, 0, 5, 4, 0, 4, 2, 1, 3, 5, 2, 4, 5, 2, 5, 3, 0, 2, 3, 0, 3, 1])
  wedge.computeVertexNormals()
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  const batches: { mesh: THREE.InstancedMesh, count: number, capacity: number }[] = []
  function batch(name: string, material: THREE.Material, capacity: number, geometry: THREE.BufferGeometry = cube) {
    const object = new THREE.InstancedMesh(geometry, material, capacity)
    object.name = name
    object.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    object.frustumCulled = false
    object.count = 0
    scene.add(object)
    const entry = { mesh: object, count: 0, capacity }
    batches.push(entry)
    return entry
  }
  function stamp(entry: typeof batches[number], x: number, y: number, z: number, sx: number, sy: number, sz: number, tint?: number, ry = 0, rx = 0) {
    if (entry.count >= entry.capacity) return
    dummy.position.set(x, y, z)
    dummy.scale.set(sx, sy, sz)
    dummy.rotation.set(rx, ry, 0)
    dummy.updateMatrix()
    entry.mesh.setMatrixAt(entry.count, dummy.matrix)
    if (tint !== undefined) entry.mesh.setColorAt(entry.count, color.setHex(tint))
    entry.count++
  }
  const ties = batch('sleepers', materials.ties, 360)
  const bodies = batch('train-bodies', materials.train, 32, rounded)
  const roofs = batch('train-roofs', materials.roof, 32, rounded)
  const undercarriages = batch('undercarriages', materials.dark, 32)
  const trim = batch('train-trim', materials.trim, 180)
  const windows = batch('train-windows', materials.glass, 360, rounded)
  const lamps = batch('headlights', materials.lamp, 64, sphere)
  const badges = batch('train-badges', materials.badge, 32, new THREE.PlaneGeometry(1, 1))
  const ramps = batch('ramps', materials.brown, 20, wedge)
  const rampBoards = batch('ramp-boards', materials.white, 160)
  const barriers = batch('striped-barriers', materials.stripes, 40)
  const posts = batch('barrier-posts', materials.red, 100)
  const coins = batch('coins', materials.gold, 100, new THREE.CylinderGeometry(0.4, 0.4, 0.12, 16).rotateX(Math.PI / 2))
  const rims = batch('coin-rims', materials.goldRim, 100, new THREE.TorusGeometry(0.31, 0.035, 4, 16))
  const facades = batch('city-buildings', materials.colored, 32)
  const cornices = batch('city-roofs', materials.colored, 32)
  const cityWindows = batch('city-windows', materials.glass, 650)
  const awnings = batch('awnings', materials.colored, 32)
  const trunks = batch('tree-trunks', materials.brown, 36, new THREE.CylinderGeometry(0.12, 0.2, 1, 7))
  const leaves = batch('tree-canopies', materials.green, 108, new THREE.IcosahedronGeometry(1, 1))
  const gantries = batch('overhead-gantries', materials.trim, 36)
  const art = batch('wall-graffiti', materials.graffiti, 12, new THREE.PlaneGeometry(1, 1))
  const arches = batch('station-bridges', materials.brick, 12)
  const trainColors = [0xffc52f, 0x43a6bb, 0xef6350, 0x6baf72]
  const cityColors = [0xf3b47a, 0xf2d39f, 0xe99783, 0x88c7c0, 0xe5aa91, 0xf0cd88]

  function avatar() {
    const group = new THREE.Group()
    group.name = 'player'
    const outfit = (color: number) => new THREE.MeshLambertMaterial({ color })
    const hoodie = outfit(0xf0ece1), cap = outfit(0xe65444), jeans = outfit(0x3486b3)
    const skin = outfit(0xe9aa78), shoes = outfit(0xffffff), backpack = outfit(0xe89537)
    group.add(mesh(hoodie, 0, 1.23, 0, 0.63, 0.76, 0.43, rounded))
    group.add(mesh(hoodie, 0, 1.67, 0.07, 0.32, 0.27, 0.3, sphere))
    group.add(mesh(skin, 0, 1.86, -0.025, 0.28, 0.31, 0.28, sphere))
    group.add(mesh(cap, 0, 2.06, 0, 0.31, 0.17, 0.31, sphere))
    group.add(mesh(cap, 0, 2.06, -0.28, 0.42, 0.055, 0.3, rounded))
    group.add(mesh(backpack, 0, 1.25, 0.3, 0.48, 0.62, 0.23, rounded))
    group.add(mesh(jeans, 0, 1.19, 0.43, 0.36, 0.2, 0.045, rounded))
    const legs = [-1, 1].map(side => {
      const leg = new THREE.Group()
      leg.position.set(side * 0.17, 0.89, 0)
      leg.add(mesh(jeans, 0, -0.37, 0, 0.26, 0.74, 0.29, rounded))
      leg.add(mesh(shoes, 0, -0.8, -0.095, 0.3, 0.18, 0.48, rounded))
      leg.add(mesh(cap, 0, -0.82, 0.13, 0.31, 0.075, 0.05))
      group.add(leg)
      return leg
    })
    const arms = [-1, 1].map(side => {
      const arm = new THREE.Group()
      arm.position.set(side * 0.41, 1.51, 0)
      arm.add(mesh(hoodie, 0, -0.22, 0, 0.23, 0.5, 0.24, rounded))
      arm.add(mesh(skin, 0, -0.51, -0.04, 0.13, 0.15, 0.13, sphere))
      group.add(arm)
      return arm
    })
    const shadow = mesh(materials.shadow, 0, 0.011, 0, 0.65, 0.65, 1, new THREE.CircleGeometry(1, 20))
    shadow.rotation.x = -Math.PI / 2
    scene.add(group, shadow)
    return { group, arms, legs, shadow }
  }
  const player = avatar()

  function pose(runner: ReturnType<typeof avatar>, state: GameState, previous: GameState, alpha: number, distance: number) {
    const y = (previous.y + (state.y - previous.y) * alpha) / 1000
    runner.group.position.set((previous.x + (state.x - previous.x) * alpha) / 1000, y, 0)
    runner.group.scale.y = state.crouching ? 0.52 : 1
    runner.group.rotation.z = (previous.x - state.x) / 10000
    const stride = state.grounded && !state.crouching ? Math.sin(distance * 2.2) * 0.7 : 0
    runner.legs.forEach((leg, i) => { leg.rotation.x = state.crouching ? -0.85 : stride * (i ? 1 : -1) })
    runner.arms.forEach((arm, i) => { arm.rotation.x = state.crouching ? -1.3 : stride * (i ? -1 : 1) - 0.2 })
    runner.shadow.position.set(runner.group.position.x, (state.grounded ? y : state.jumpTicks ? state.jumpOriginY / 1000 : 0) + 0.012, runner.group.position.z)
    runner.shadow.scale.setScalar(state.grounded ? 0.65 : 0.45)
  }

  function train(item: TrackItem, z: number) {
    const x = item.lane * LANE_WIDTH / 1000
    const length = (item.length ?? TRAIN_LENGTH) / 1000
    const ramp = item.ramp ? RAMP_LENGTH / 1000 : 0
    const bodyLength = length - ramp
    const front = z - ramp
    const center = front - bodyLength / 2
    const tint = materials.train.map ? 0xffffff : item.speed ? 0xdd443a : trainColors[Math.floor(item.id / 16) % trainColors.length]!
    stamp(undercarriages, x, 0.27, center, 1.8, 0.5, bodyLength)
    stamp(bodies, x, 1.58, center, 2.08, 2.6, bodyLength, tint)
    stamp(roofs, x, 2.9, center, 2.12, 0.2, bodyLength)
    stamp(trim, x, 1.11, center, 2.1, 0.28, bodyLength + 0.04)
    stamp(windows, x, 2.2, front + 0.025, 1.55, 0.67, 0.08)
    stamp(badges, x, 1.48, front + 0.1, 0.3, 0.3, 1)
    for (const side of [-1, 1]) {
      stamp(lamps, x + side * 0.72, 1.52, front + 0.08, 0.12, 0.12, 0.08)
      for (let i = 0; i < 5; i++) stamp(windows, x + side * 1.042, 2.15, front - (i + 0.65) * bodyLength / 5.5, 0.04, 0.61, 1.2)
      for (let i = 0; i < 2; i++) stamp(trim, x + side * 1.048, 1.4, front - bodyLength * (0.3 + i * 0.4), 0.045, 1.95, 0.085)
    }
    if (ramp) {
      stamp(ramps, x, 0, z - ramp / 2, 2.08, TRAIN_HEIGHT / 1000, ramp)
      const slope = Math.atan2(TRAIN_HEIGHT / 1000, ramp)
      for (let i = 1; i <= 7; i++) stamp(rampBoards, x, i / 8 * 3 + 0.025, z - i / 8 * ramp, 1.96, 0.05, 0.16, undefined, 0, slope)
    }
  }

  function update(frame: RunnerFrame) {
    const { state, previous, alpha, course } = frame
    const distance = (previous.distance + (state.distance - previous.distance) * alpha) / 1000
    const tick = previous.tick + (state.tick - previous.tick) * alpha
    if (materials.track.map) materials.track.map.offset.y = distance * 70 / 160 % 1
    if (materials.brick.map) materials.brick.map.offset.x = distance * 35 / 160 % 1
    for (const entry of batches) entry.count = 0
    for (const item of course) {
      const z = distance - itemDistance(item, tick) / 1000
      if (z < -130 || z - itemLength(item) / 1000 > 6) continue
      const x = item.lane * LANE_WIDTH / 1000
      if (item.kind === 'train') train(item, z)
      if (item.kind === 'coin' && item.distance > state.distance) {
        const y = (item.elevation ?? 0) / 1000 + 1.05
        const spin = distance * 0.35 + item.id
        stamp(coins, x, y, z, 1, 1, 1, undefined, spin)
        stamp(rims, x + Math.sin(spin) * 0.065, y, z + Math.cos(spin) * 0.065, 1, 1, 1, undefined, spin)
      }
      if (item.kind === 'block') stamp(barriers, x, 1.5, z, 1.9, 3, 0.6)
      if (item.kind === 'jump') {
        stamp(barriers, x, BARRIER_HEIGHT / 2000, z - itemLength(item) / 2000, 1.9, BARRIER_HEIGHT / 1000, itemLength(item) / 1000)
      }
      if (item.kind === 'crouch') {
        stamp(barriers, x, 1.72, z, 2.05, 0.65, 0.35)
        for (const side of [-1, 1]) stamp(posts, x + side * 1, 0.85, z, 0.13, 1.7, 0.3)
      }
    }
    for (let i = 0; i < 330; i++) stamp(ties, (i % 3 - 1) * 2.4, 0.005, (Math.floor(i / 3) * 1.3 + distance) % 143 - 132, 1.98, 0.09, 0.19)
    for (let i = 0; i < 28; i++) {
      const side = i % 2 ? -1 : 1
      const z = (Math.floor(i / 2) * 12 + distance) % 168 - 150
      const height = 5.5 + i % 4 * 1.1
      const x = side * (9.3 + i % 3 * 0.6)
      stamp(facades, x, height / 2, z, 5, height, 8, cityColors[i % cityColors.length])
      stamp(cornices, x, height + 0.12, z, 5.3, 0.35, 8.3, i % 2 ? 0xc56549 : 0x487b8e)
      stamp(awnings, x - side * 2.65, 2, z, 0.8, 0.22, 6, i % 3 ? 0xf4e7c7 : 0xe3654d)
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          stamp(cityWindows, x - side * 2.505, 2.65 + row * 1.15, z - 2.6 + col * 2.5, 0.025, 0.77, 1.1)
          stamp(cityWindows, x - 1.5 + col * 1.5, 2.65 + row * 1.15, z + 4.015, 0.8, 0.77, 0.025)
        }
      }
      const treeX = side * 6.25
      const treeZ = z + 4.9
      stamp(trunks, treeX, 1.5, treeZ, 1, 3, 1)
      for (let crown = 0; crown < 3; crown++) stamp(leaves, treeX + (crown - 1) * 0.7, 3.7 + crown % 2 * 0.65, treeZ, 1.05, 1.4, 1.1)
    }
    for (let i = 0; i < 5; i++) {
      const z = (i * 32 + distance) % 160 - 140
      for (const side of [-1, 1]) {
        stamp(gantries, side * 4.12, 3.8, z, 0.11, 7.6, 0.16)
        stamp(art, side * 4.48, 0.93, z - 8, 2.2, 1.15, 1, undefined, side * -Math.PI / 2)
      }
      stamp(gantries, 0, 7.6, z, 8.35, 0.15, 0.2)
    }
    for (let i = 0; i < 2; i++) {
      const z = (i * 100 + distance) % 200 - 180
      for (const side of [-1, 1]) stamp(arches, side * 4.8, 4.2, z, 0.75, 8.4, 3)
      stamp(arches, 0, 8.7, z, 10.4, 1.1, 3)
    }
    for (const entry of batches) {
      entry.mesh.count = entry.count
      entry.mesh.instanceMatrix.needsUpdate = true
      if (entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true
    }
    pose(player, state, previous, alpha, distance)
    player.group.visible = !frame.firstPerson && (state.invulnerableTicks === 0 || Math.floor(state.tick / 6) % 2 === 0)
    player.shadow.visible = !frame.firstPerson
    const fov = frame.firstPerson ? 78 : 58
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix() }
    if (frame.firstPerson) {
      const eye = player.group.position.y + (state.crouching ? 0.9 : 1.75)
      camera.position.set(player.group.position.x, eye, 0.12)
      camera.lookAt(player.group.position.x, eye - 0.65, -24)
    } else {
      const lift = Math.min(TRAIN_HEIGHT / 1000, player.group.position.y)
      camera.position.set(0, 5.7 + lift * 0.75, camera.aspect < 1 ? 12 : 8)
      camera.lookAt(0, 1.3 + lift * 0.7, -16)
    }
  }

  return {
    scene, camera, update,
    async loadTextures() {
      const loader = new THREE.TextureLoader()
      const source = 'https://raw.githubusercontent.com/RohanChacko/Subway-Surfers/master/assets/'
      const assets: [string, THREE.MeshLambertMaterial, number, number][] = [
        ['train.jpg', materials.train, 1, 1], ['track.jpeg', materials.track, 1, 70],
        ['wall.jpg', materials.brick, 35, 1], ['barrier.jpg', materials.stripes, 1, 1],
      ]
      const results = await Promise.allSettled(assets.map(async ([file, material, repeatX, repeatY]) => {
        const map = await loader.loadAsync(source + file)
        if (disposed) { map.dispose(); return }
        map.colorSpace = THREE.SRGBColorSpace
        map.wrapS = map.wrapT = THREE.RepeatWrapping
        map.repeat.set(repeatX, repeatY)
        map.anisotropy = 4
        textures.push(map)
        material.map = map
        material.color.setHex(0xffffff)
        material.needsUpdate = true
      }))
      return results.every(result => result.status === 'fulfilled')
    },
    dispose() {
      disposed = true
      const geometries = new Set<THREE.BufferGeometry>([cube, rounded, sphere, wedge])
      const allocated = new Set<THREE.Material>(Object.values(materials))
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry)
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) allocated.add(material)
        }
        if (object instanceof THREE.InstancedMesh) object.dispose()
      })
      geometries.forEach(geometry => geometry.dispose())
      allocated.forEach(material => material.dispose())
      textures.forEach(map => map.dispose())
    },
  }
}
