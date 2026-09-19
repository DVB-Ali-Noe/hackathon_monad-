import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, encodePacked, http, keccak256, toHex, zeroHash } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'
import { finishedRun } from '../fixtures.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function until(check, timeout = 30000) {
  const end = Date.now() + timeout
  let lastError
  while (Date.now() < end) {
    try { const value = await check(); if (value) return value } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('Délai du test dépassé', { cause: lastError })
}
async function stop(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise(resolve => { child.once('exit', resolve); child.kill(signal) })
}

test('intégration HTTP et Monad sans base : profils, sessions, replay et concurrence entre deux serveurs', { timeout: 300000 }, async (t) => {
  assert.ok(existsSync(`${root}.output/server/index.mjs`), 'Lancer pnpm build avant ce test.')
  const chainPort = await freePort()
  const ports = [await freePort(), await freePort()]
  const origins = ports.map(port => `http://127.0.0.1:${port}`)
  const origin = origins[0]
  const rpcUrl = `http://127.0.0.1:${chainPort}`
  const privateKey = generatePrivateKey()
  const servers = []
  const localAnvil = `${homedir()}/.foundry/bin/anvil`
  const anvil = spawn(process.env.ANVIL_BINARY || (existsSync(localAnvil) ? localAnvil : 'anvil'), ['--port', String(chainPort), '--chain-id', '10143', '--block-time', '1', '--silent'], { stdio: 'ignore' })
  t.after(async () => { await Promise.all(servers.map(server => stop(server))); await stop(anvil) })
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl, { retryCount: 0 }) })
  await until(async () => await client.getChainId() === 10143)
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpcUrl) })
  await client.request({ method: 'anvil_setBalance', params: [account.address, '0x3635c9adc5dea00000'] })
  const artifact = JSON.parse(await readFile(`${root}contracts/out/MonadSurf.sol/MonadSurf.json`, 'utf8'))
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [account.address] })
  const deployed = await client.waitForTransactionReceipt({ hash, pollingInterval: 100 })
  const contract = deployed.contractAddress
  const read = (functionName, args = []) => client.readContract({ address: contract, abi: artifact.abi, functionName, args })
  const movesKey = generatePrivateKey()
  const movesAccount = privateKeyToAccount(movesKey)
  const movesWallet = createWalletClient({ account: movesAccount, chain: monadTestnet, transport: http(rpcUrl) })
  await client.request({ method: 'anvil_setBalance', params: [movesAccount.address, '0x3635c9adc5dea00000'] })
  const movesArtifact = JSON.parse(await readFile(`${root}contracts/out/MonadMoves.sol/MonadMoves.json`, 'utf8'))
  const movesHash = await movesWallet.deployContract({ abi: movesArtifact.abi, bytecode: movesArtifact.bytecode.object, args: [contract, movesAccount.address] })
  const movesContract = (await client.waitForTransactionReceipt({ hash: movesHash, pollingInterval: 100 })).contractAddress
  async function startServer(index, enableMoves = true) {
    const env = { ...process.env, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(ports[index]),
      NUXT_SITE_ORIGIN: origin, NUXT_MONAD_RPC_URL: rpcUrl, NUXT_MONAD_CONTRACT_ADDRESS: contract, NUXT_RELAYER_PRIVATE_KEY: privateKey,
      NUXT_MONAD_MOVES_ADDRESS: enableMoves ? movesContract : '', NUXT_MOVES_RELAYER_PRIVATE_KEY: enableMoves ? movesKey : '' }
    delete env.NUXT_DATABASE_URL
    delete env.NUXT_RELAY_SECRET
    servers[index] = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, env, stdio: 'ignore' })
    await until(async () => (await fetch(origins[index])).ok)
  }
  await Promise.all([startServer(0), startServer(1)])
  async function request(path, { method = 'GET', cookie, body, headers = {}, instance = 0 } = {}) {
    const response = await fetch(`${origins[instance]}${path}`, { method,
      headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { response, status: response.status, body: await response.json() }
  }
  async function session(pseudo) {
    const result = await request('/api/session', { method: 'POST', body: { pseudo } })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.match(result.response.headers.get('set-cookie'), /HttpOnly/i)
    return { ...result.body, cookie: result.response.headers.get('set-cookie').split(';')[0] }
  }
  async function create(player) {
    const requestKey = randomUUID()
    const result = await request('/api/runs', { method: 'POST', cookie: player.cookie, body: { requestKey } })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const retry = await request('/api/runs', { method: 'POST', cookie: player.cookie, body: { requestKey }, instance: 1 })
    assert.deepEqual(retry.body, result.body)
    return result.body
  }
  await t.test('SSR sans secret, contrôle d’origine et classement vide lisible sans base', async () => {
    const home = await fetch(origin)
    const html = await home.text()
    assert.equal(home.status, 200)
    assert.ok(html.includes('Subway Frauder') && html.includes('Leaderboard target') && html.includes('lives remaining'))
    assert.ok(!html.includes('href="/calibration"') && !html.includes(privateKey) && !html.includes(movesKey))
    assert.equal((await request('/api/session', { method: 'POST', body: { pseudo: 'Test' }, headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await request('/api/runs', { method: 'POST', body: { requestKey: randomUUID() } })).status, 401)
    assert.deepEqual((await request('/api/leaderboard')).body.entries, [])
  })
  const alice = await session('Noé')
  const bob = await session('Noé')
  assert.notEqual(alice.playerId, bob.playerId)
  assert.equal((await read('getPlayer', [alice.playerId])).pseudo, 'Noé')
  const first = await create(alice)
  const second = await create(bob)
  const runA = finishedRun(first)
  const runB = finishedRun(second, 1)
  const moving = await create(alice)
  const movePath = `/api/runs/${moving.runId}/movements`
  const firstMove = { sequence: 0, tick: 0, lane: -1, action: 'none' }
  let firstMoveReceipt
  await t.test('mouvements live : origine, propriétaire, bornes, ordre et reprise concurrente', async () => {
    const post = (body, options = {}) => request(movePath, { method: 'POST', cookie: alice.cookie, body, ...options })
    assert.equal((await post(firstMove, { cookie: undefined })).status, 401)
    assert.equal((await post(firstMove, { cookie: bob.cookie })).status, 404)
    assert.equal((await post(firstMove, { headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await post({ ...firstMove, lane: 8 })).status, 400)
    assert.equal((await post({ ...firstMove, tick: 107999 })).status, 422)
    assert.equal((await post({ ...firstMove, sequence: 1 })).status, 409)
    assert.equal((await post({ ...firstMove, lane: 0 })).status, 422)
    assert.equal((await request(`${movePath}/0`, { cookie: alice.cookie })).status, 404)
    const results = await Promise.all([post(firstMove), post(firstMove, { instance: 1 })])
    for (const result of results) {
      assert.equal(result.status, 200, JSON.stringify(result.body))
      assert.ok(['included', 'confirmed'].includes(result.body.status))
    }
    firstMoveReceipt = results[0].body
    assert.equal(firstMoveReceipt.transactionHash, results[1].body.transactionHash)
    assert.equal(firstMoveReceipt.historyHash, keccak256(encodePacked(['bytes32', 'uint32', 'uint32', 'uint8'], [zeroHash, 0, 0, 0])))
    assert.equal((await post({ ...firstMove, action: 'jump' })).status, 409)
    assert.equal((await post({ sequence: 1, tick: 0, lane: 0, action: 'none' })).status, 422)
    assert.equal((await post({ sequence: 1, tick: 1, lane: -1, action: 'none' })).status, 422)
    const next = await post({ sequence: 1, tick: 1, lane: 0, action: 'jump' })
    assert.equal(next.status, 200, JSON.stringify(next.body))
    assert.notEqual(next.body.transactionHash, firstMoveReceipt.transactionHash)
    const progress = await request(movePath, { cookie: alice.cookie })
    assert.equal(progress.body.nextSequence, 2)
    assert.deepEqual(progress.body.lastInput, { lane: 0, action: 'jump' })
    const logs = await client.getContractEvents({ address: movesContract, abi: movesArtifact.abi, eventName: 'MovementRecorded', args: { runId: moving.runId }, fromBlock: 0n })
    assert.equal(logs.length, 2)
    const transactions = await Promise.all(logs.map(log => client.getTransaction({ hash: log.transactionHash })))
    assert.ok(transactions.every(tx => tx.from.toLowerCase() === movesAccount.address.toLowerCase()))
    assert.equal(new Set(transactions.map(tx => tx.hash)).size, 2)
    assert.equal((await read('getPlayer', [alice.playerId])).runs, 0n)
  })
  await t.test('propriété, paramètres onchain et rejeu falsifié', async () => {
    assert.equal((await request(`/api/runs/${first.runId}`, { cookie: bob.cookie })).status, 404)
    assert.equal((await request('/api/run', { method: 'POST', cookie: bob.cookie, body: runA })).status, 404)
    assert.equal((await request('/api/run', { method: 'POST', cookie: alice.cookie, body: { ...runA, score: runA.score + 100 } })).status, 422)
    const stored = await read('getRun', [first.runId])
    assert.equal(stored.seed, `0x${first.seed}`)
    assert.equal(stored.playerId, alice.playerId)
    assert.equal(stored.submittedBlock, 0n)
    const future = { ...runA, tickCount: 108000, inputs: Array.from({ length: 108000 }, () => ({ lane: 0, action: 'none' })) }
    const early = await request('/api/run', { method: 'POST', cookie: alice.cookie, body: future })
    assert.equal(early.status, 422)
    assert.match(early.body.data.message, /durée simulée/)
  })
  const starts = await Promise.all([first, second].map(run => read('getRun', [run.runId])))
  const finishedAt = Math.max(...[runA, runB].map((run, index) => Number(starts[index].createdAt) * 1000 + run.tickCount * 1000 / 60))
  await new Promise(resolve => setTimeout(resolve, Math.max(0, finishedAt - Date.now()) + 1000))
  await t.test('soumissions concurrentes entre instances : unicité et nonces indépendants', async () => {
    const results = await Promise.all([
      request('/api/run', { method: 'POST', cookie: alice.cookie, body: runA }),
      request('/api/run', { method: 'POST', cookie: alice.cookie, body: runA, instance: 1 }),
      request('/api/run', { method: 'POST', cookie: bob.cookie, body: runB, instance: 1 }),
    ])
    for (const result of results) { assert.equal(result.status, 200, JSON.stringify(result.body)); assert.ok(['submitted', 'confirmed'].includes(result.body.status)) }
    for (const [player, run] of [[alice, runA], [bob, runB]]) {
      const saved = await read('getPlayer', [player.playerId])
      assert.equal(saved.runs, 1n)
      assert.equal(saved.bestScore, BigInt(run.score))
      assert.equal(saved.coins, BigInt(run.coins))
    }
    const different = finishedRun(first, 1)
    const expiry = Number(starts[0].createdAt) * 1000 + different.tickCount * 1000 / 60
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry - Date.now()) + 1000))
    assert.equal((await request('/api/run', { method: 'POST', cookie: alice.cookie, body: different })).status, 409)
    const logs = await client.getContractEvents({ address: contract, abi: artifact.abi, eventName: 'RunSubmitted', fromBlock: 0n })
    assert.equal(logs.length, 2)
    for (const log of logs) {
      const result = log.args.runId === first.runId ? runA : runB
      const inputs = toHex(Uint8Array.from(result.inputs, input => (input.lane + 1) * 3 + ['none', 'jump', 'crouch'].indexOf(input.action)))
      assert.equal(log.args.inputs, inputs)
      assert.equal((await read('getRun', [log.args.runId])).replayHash, keccak256(inputs))
    }
    const transactions = await Promise.all(logs.map(log => client.getTransaction({ hash: log.transactionHash })))
    assert.equal(new Set(transactions.map(tx => tx.nonce)).size, 2)
  })
  await t.test('redémarrage sans stockage local : session, résultats et pseudos conservés', async () => {
    await Promise.all(servers.map(server => stop(server)))
    await Promise.all([startServer(0), startServer(1)])
    const result = await request('/api/run', { method: 'POST', cookie: alice.cookie, body: runA })
    assert.equal(result.status, 200)
    assert.equal(result.body.status, 'confirmed')
    assert.equal((await read('getPlayer', [alice.playerId])).runs, 1n)
    const moveRetry = await request(movePath, { method: 'POST', cookie: alice.cookie, body: firstMove, instance: 1 })
    assert.equal(moveRetry.status, 200, JSON.stringify(moveRetry.body))
    assert.equal(moveRetry.body.transactionHash, firstMoveReceipt.transactionHash)
    assert.equal((await request(`${movePath}/0`, { cookie: alice.cookie })).body.status, 'confirmed')
    assert.equal((await request(movePath, { cookie: alice.cookie })).body.nextSequence, 2)
    const lateMismatch = await request(`/api/runs/${first.runId}/movements`, { method: 'POST', cookie: alice.cookie, body: firstMove })
    assert.equal(lateMismatch.status, 422)
    const lateValid = await request(`/api/runs/${second.runId}/movements`, { method: 'POST', cookie: bob.cookie, body: { ...firstMove, lane: 1 } })
    assert.equal(lateValid.status, 200, JSON.stringify(lateValid.body))
    assert.equal((await read('getPlayer', [bob.playerId])).runs, 1n)
    const rename = await request('/api/session', { method: 'POST', cookie: alice.cookie, body: { pseudo: 'Alice' } })
    assert.equal(rename.body.playerId, alice.playerId)
    const ranking = await request('/api/leaderboard')
    assert.equal(ranking.status, 200)
    assert.equal(ranking.body.entries.length, 2)
    assert.equal(ranking.body.entries.find(entry => entry.playerId === alice.playerId).pseudo, 'Alice')
    assert.ok(BigInt(ranking.body.entries[0].score) >= BigInt(ranking.body.entries[1].score))
  })
  await t.test('journal désactivé : les scores et le classement restent disponibles', async () => {
    await stop(servers[1])
    await startServer(1, false)
    assert.equal((await request(movePath, { cookie: alice.cookie, instance: 1 })).status, 503)
    assert.equal((await request('/api/run', { method: 'POST', cookie: bob.cookie, body: runB, instance: 1 })).status, 200)
    assert.equal((await request('/api/leaderboard', { instance: 1 })).status, 200)
  })
  await t.test('révocation onchain refuse une copie du cookie sur une autre instance', async () => {
    assert.equal((await request('/api/session', { method: 'DELETE', cookie: alice.cookie, body: {} })).status, 200)
    assert.equal((await read('getPlayer', [alice.playerId])).sessionExpiresAt, 0n)
    assert.equal((await request(`/api/runs/${first.runId}`, { cookie: alice.cookie, instance: 1 })).status, 401)
    assert.equal((await request(movePath, { method: 'POST', cookie: alice.cookie, body: firstMove })).status, 401)
    assert.equal((await read('getPlayer', [alice.playerId])).runs, 1n)
  })
})
