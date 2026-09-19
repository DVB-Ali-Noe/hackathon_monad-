import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createPublicClient, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

test('déploiement : simulation, mauvais compte/réseau, reçu, bytecode et reprise sans double création', { timeout: 60000 }, async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const directory = await mkdtemp(`${tmpdir()}/monad-deployment-`)
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const localAnvil = `${homedir()}/.foundry/bin/anvil`
  const anvil = spawn(process.env.ANVIL_BINARY || (existsSync(localAnvil) ? localAnvil : 'anvil'), ['--port', String(port), '--chain-id', '10143', '--block-time', '1', '--silent'], { stdio: 'ignore' })
  t.after(async () => {
    if (anvil.exitCode === null) await new Promise(resolve => { anvil.once('exit', resolve); anvil.kill('SIGTERM') })
    await rm(directory, { recursive: true, force: true })
  })
  const rpcUrl = `http://127.0.0.1:${port}`
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl, { retryCount: 0, timeout: 1000 }) })
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = await client.getChainId() === 10143; if (ready) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, 'Anvil doit être disponible.')
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  await client.request({ method: 'anvil_setBalance', params: [account.address, '0x3635c9adc5dea00000'] })
  await mkdir(`${directory}/contracts/src`, { recursive: true })
  await mkdir(`${directory}/contracts/out/MonadSurf.sol`, { recursive: true })
  for (const file of ['contracts/src/MonadSurf.sol', 'contracts/out/MonadSurf.sol/MonadSurf.json']) await copyFile(`${root}${file}`, `${directory}/${file}`)
  await writeFile(`${directory}/.env`, `NUXT_RELAYER_PRIVATE_KEY=${privateKey}\nNUXT_MONAD_RPC_URL=${rpcUrl}\nNUXT_MONAD_CONTRACT_ADDRESS=\n`, { mode: 0o600 })
  async function run({ broadcast = false, deployer = account.address } = {}) {
    const child = spawn(process.execPath, ['--env-file=.env', `${root}scripts/deploy-monad.mjs`, '--deployer', deployer, ...(broadcast ? ['--broadcast'] : [])],
      { cwd: directory, env: { ...process.env, NUXT_RELAYER_PRIVATE_KEY: privateKey, NUXT_MONAD_RPC_URL: rpcUrl, NUXT_MONAD_CONTRACT_ADDRESS: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    assert.ok(!output.includes(privateKey), 'Aucune clé privée dans les logs.')
    return { code, output }
  }
  assert.equal((await run({ deployer: privateKeyToAccount(generatePrivateKey()).address, broadcast: true })).code, 1)
  await client.request({ method: 'anvil_setChainId', params: [1337] })
  assert.equal((await run({ broadcast: true })).code, 1)
  await client.request({ method: 'anvil_setChainId', params: [10143] })
  const preview = await run()
  assert.equal(preview.code, 0, preview.output)
  assert.equal(await client.getTransactionCount({ address: account.address }), 0)
  assert.ok(!existsSync(`${directory}/contracts/broadcast/monad-testnet.json`))
  const result = await run({ broadcast: true })
  assert.equal(result.code, 0, result.output)
  const manifest = JSON.parse(await readFile(`${directory}/contracts/deployments/monad-testnet.json`, 'utf8'))
  assert.equal(manifest.relayer, account.address)
  assert.equal(manifest.chainId, 10143)
  assert.equal((await client.getTransactionReceipt({ hash: manifest.transactionHash })).status, 'success')
  assert.ok((await readFile(`${directory}/.env`, 'utf8')).includes(`NUXT_MONAD_CONTRACT_ADDRESS=${manifest.address}`))
  assert.equal((await stat(`${directory}/.env`)).mode & 0o777, 0o600)
  const retry = await run({ broadcast: true })
  assert.equal(retry.code, 0, retry.output)
  assert.equal(await client.getTransactionCount({ address: account.address }), 1)
  assert.deepEqual(JSON.parse(await readFile(`${directory}/contracts/deployments/monad-testnet.json`, 'utf8')), manifest)
  assert.ok(!existsSync(`${directory}/contracts/broadcast/monad-testnet.json.lock`))
})
