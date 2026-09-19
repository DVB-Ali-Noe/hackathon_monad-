import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem'
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
async function stop(child) {
  if (!child || child.exitCode !== null) return
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM') })
}

test('intégration HTTP, PostgreSQL et EVM : sessions, rejeu, reprise relayer et top 25', { timeout: 120000 }, async (t) => {
  assert.ok(existsSync(`${root}.output/server/index.mjs`), 'Lancer pnpm build avant ce test.')
  assert.ok(existsSync(`${root}contracts/out/MonadSurf.sol/MonadSurf.json`), 'Compiler le contrat avec Forge avant ce test.')
  const container = `monad-blitz-test-${process.pid}-${randomBytes(3).toString('hex')}`
  const databasePort = await freePort()
  const chainPort = await freePort()
  const apiPort = await freePort()
  const password = randomBytes(16).toString('hex')
  const privateKey = generatePrivateKey()
  const relaySecret = randomBytes(32).toString('hex')
  const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${databasePort}/postgres`
  const origin = `http://127.0.0.1:${apiPort}`
  const rpcUrl = `http://127.0.0.1:${chainPort}`
  let sql, anvil, server
  t.after(async () => {
    await stop(server)
    await stop(anvil)
    if (sql) await sql.end({ timeout: 1 })
    try { execFileSync('docker', ['stop', container], { stdio: 'ignore' }) } catch {}
  })
  execFileSync('docker', ['run', '--detach', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`, '-p', `127.0.0.1:${databasePort}:5432`, 'postgres:17-alpine'], { stdio: 'pipe' })
  sql = postgres(databaseUrl, { max: 3, connect_timeout: 2, onnotice() {} })
  await until(async () => { await sql`select 1`; return true })
  await sql.unsafe(await readFile(new URL('../../server/database/schema.sql', import.meta.url), 'utf8'))
  const localAnvil = `${homedir()}/.foundry/bin/anvil`
  anvil = spawn(existsSync(localAnvil) ? localAnvil : 'anvil', ['--port', String(chainPort), '--chain-id', '10143', '--silent'], { stdio: 'ignore' })
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl, { retryCount: 0 }) })
  await until(async () => await client.getChainId() === 10143)
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpcUrl) })
  await client.request({ method: 'anvil_setBalance', params: [account.address, '0x3635c9adc5dea00000'] })
  const artifact = JSON.parse(await readFile(`${root}contracts/out/MonadSurf.sol/MonadSurf.json`, 'utf8'))
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [account.address] })
  const deployed = await client.waitForTransactionReceipt({ hash })
  const contract = deployed.contractAddress
  const env = { ...process.env, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(apiPort), NUXT_DATABASE_URL: databaseUrl,
    NUXT_SITE_ORIGIN: origin, NUXT_MONAD_RPC_URL: rpcUrl, NUXT_MONAD_CONTRACT_ADDRESS: contract,
    NUXT_RELAYER_PRIVATE_KEY: privateKey, NUXT_RELAY_SECRET: relaySecret }
  async function startServer() {
    server = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: root, env, stdio: 'pipe' })
    server.stdout.resume()
    server.stderr.resume()
    await until(async () => (await fetch(origin)).ok)
  }
  await startServer()
  async function request(path, { method = 'GET', cookie, body, headers = {} } = {}) {
    const response = await fetch(`${origin}${path}`, { method,
      headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { response, status: response.status, body: await response.json() }
  }
  async function session(pseudo) {
    const result = await request('/api/session', { method: 'POST', body: { pseudo } })
    assert.equal(result.status, 200)
    assert.match(result.response.headers.get('set-cookie'), /HttpOnly/i)
    return { ...result.body, cookie: result.response.headers.get('set-cookie').split(';')[0] }
  }
  async function create(player) {
    const requestKey = randomUUID()
    const result = await request('/api/runs', { method: 'POST', cookie: player.cookie, body: { requestKey } })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    const retry = await request('/api/runs', { method: 'POST', cookie: player.cookie, body: { requestKey } })
    assert.equal(retry.body.runId, result.body.runId)
    return result.body
  }
  await t.test('SSR sans secret, contrôle d’origine et authentification', async () => {
    const html = await (await fetch(`${origin}/jeu`)).text()
    assert.ok(html.includes('Subway Frauder'))
    const home = await fetch(origin)
    assert.equal(home.status, 200)
    const homeHtml = await home.text()
    assert.ok(homeHtml.includes('Leaderboard target'))
    assert.ok(homeHtml.includes('lives remaining'))
    assert.ok(!homeHtml.includes('href="/calibration"'))
    for (const secret of [privateKey, relaySecret, password]) assert.ok(!html.includes(secret))
    assert.equal((await request('/api/session', { method: 'POST', body: { pseudo: 'Test' }, headers: { origin: 'https://evil.example' } })).status, 403)
    assert.equal((await request('/api/runs', { method: 'POST', body: { requestKey: randomUUID() } })).status, 401)
    assert.equal((await request('/api/relay', { method: 'POST' })).status, 401)
    assert.deepEqual((await request('/api/leaderboard')).body.entries, [])
  })
  const alice = await session('Noé')
  const bob = await session('Noé')
  assert.notEqual(alice.playerId, bob.playerId)
  const first = await create(alice)
  const second = await create(bob)
  const runA = finishedRun(first)
  const runB = finishedRun(second)
  await t.test('propriété de partie, rejeu falsifié et horloge serveur', async () => {
    assert.equal((await request(`/api/runs/${first.runId}`, { cookie: bob.cookie })).status, 404)
    assert.equal((await request('/api/run', { method: 'POST', cookie: alice.cookie, body: runA })).status, 422)
    await sql`update runs set created_at = created_at - interval '10 minutes'`
    assert.equal((await request('/api/run', { method: 'POST', cookie: alice.cookie, body: { ...runA, score: runA.score + 100 } })).status, 422)
    assert.equal((await request('/api/run', { method: 'POST', cookie: bob.cookie, body: runA })).status, 404)
    assert.equal((await sql`select count(*)::int as count from runs where status != 'ready'`)[0].count, 0)
  })
  await t.test('soumissions concurrentes identiques : un résultat et aucune signature avant validation', async () => {
    const results = await Promise.all([1, 2].map(() => request('/api/run', { method: 'POST', cookie: alice.cookie, body: runA })))
    for (const result of results) { assert.equal(result.status, 200); assert.equal(result.body.status, 'queued') }
    assert.equal((await request('/api/run', { method: 'POST', cookie: bob.cookie, body: runB })).status, 200)
    const [row] = await sql`select payload_hash, raw_transaction, result from runs where id = ${first.runId}`
    assert.ok(row.payload_hash)
    assert.equal(row.raw_transaction, null)
    assert.deepEqual(row.result, runA)
    const different = finishedRun(first, 1)
    assert.equal((await request('/api/run', { method: 'POST', cookie: alice.cookie, body: different })).status, 409)
  })
  await t.test('reprise après redémarrage, diffusion concurrente et coordination des nonces', async () => {
    await client.request({ method: 'evm_setAutomine', params: [false] })
    const sent = await request(`/api/runs/${first.runId}/relay`, { method: 'POST', cookie: alice.cookie, body: {} })
    assert.equal(sent.status, 200, JSON.stringify(sent.body))
    assert.equal(sent.body.status, 'submitted')
    const [stored] = await sql`select transaction_hash, raw_transaction from runs where id = ${first.runId}`
    assert.ok(stored.raw_transaction)
    await stop(server)
    await startServer()
    const concurrent = await Promise.all([1, 2, 3].map(() => request(`/api/runs/${first.runId}/relay`, { method: 'POST', cookie: alice.cookie, body: {} })))
    for (const response of concurrent) assert.equal(response.body.transactionHash, stored.transaction_hash)
    assert.equal((await sql`select raw_transaction from runs where id = ${first.runId}`)[0].raw_transaction, stored.raw_transaction)
    await client.request({ method: 'evm_setAutomine', params: [true] })
    await until(async () => {
      await client.request({ method: 'evm_mine', params: [] })
      const response = await request('/api/relay', { method: 'POST', headers: { authorization: `Bearer ${relaySecret}` } })
      assert.equal(response.status, 200)
      return (await sql`select count(*)::int as count from runs where status = 'confirmed'`)[0].count === 2
    })
    const after = await request('/api/run', { method: 'POST', cookie: alice.cookie, body: runA })
    assert.equal(after.body.status, 'confirmed')
    for (const [player, run] of [[alice, runA], [bob, runB]]) {
      const chainPlayer = await client.readContract({ address: contract, abi: artifact.abi, functionName: 'getPlayer', args: [player.playerId] })
      assert.equal(chainPlayer.runs, 1n)
      assert.equal(chainPlayer.bestScore, BigInt(run.score))
      assert.equal(chainPlayer.coins, BigInt(run.coins))
    }
    const logs = await client.getLogs({ address: contract, event: parseAbiItem('event RunSubmitted(bytes32 indexed runId, bytes32 indexed playerId, uint64 score, uint64 coins)'), fromBlock: 0n })
    assert.equal(logs.length, 2)
    const txs = await Promise.all(logs.map(log => client.getTransaction({ hash: log.transactionHash })))
    assert.equal(new Set(txs.map(tx => tx.nonce)).size, 2)
  })
  await t.test('classement exact avec pseudos, puis fin explicite de session', async () => {
    const ranking = await request('/api/leaderboard')
    assert.equal(ranking.status, 200)
    assert.equal(ranking.body.entries.length, 2)
    for (const entry of ranking.body.entries) { assert.equal(entry.pseudo, 'Noé'); assert.equal(typeof entry.score, 'string') }
    assert.ok(BigInt(ranking.body.entries[0].score) >= BigInt(ranking.body.entries[1].score))
    assert.equal((await request('/api/session', { method: 'DELETE', cookie: alice.cookie, body: {} })).status, 200)
    assert.equal((await request(`/api/runs/${first.runId}`, { cookie: alice.cookie })).status, 401)
  })
})
