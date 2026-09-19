import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { createPublicClient, createWalletClient, encodeDeployData, formatEther, getAddress, getContractAddress, http, keccak256, pad, parseEther, parseTransaction, recoverTransactionAddress, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from 'viem/chains'

class DeploymentError extends Error {}
function requireCondition(condition, message) { if (!condition) throw new DeploymentError(message) }
async function readOptional(path) {
  try { return await readFile(path, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

async function deploy() {
  const { values } = parseArgs({ options: { deployer: { type: 'string' }, broadcast: { type: 'boolean', default: false }, 'max-cost': { type: 'string', default: '0.2' } } })
  requireCondition(values.deployer, 'Indiquer --deployer avec l’adresse publique attendue.')
  const expected = getAddress(values.deployer)
  const key = process.env.NUXT_RELAYER_PRIVATE_KEY
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(key ?? ''), 'Renseigner NUXT_RELAYER_PRIVATE_KEY dans le .env local.')
  const account = privateKeyToAccount(key)
  requireCondition(account.address === expected, 'La clé ne correspond pas à l’adresse --deployer ; aucun envoi.')
  const transport = http(process.env.NUXT_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz', { timeout: 15000, retryCount: 0 })
  const client = createPublicClient({ chain: monadTestnet, transport })
  const wallet = createWalletClient({ account, chain: monadTestnet, transport })
  requireCondition(await client.getChainId() === 10143, 'Le RPC doit cibler Monad testnet (10143).')
  const artifact = JSON.parse(await readFile('contracts/out/MonadSurf.sol/MonadSurf.json', 'utf8'))
  const sourceHash = keccak256(stringToHex(await readFile('contracts/src/MonadSurf.sol', 'utf8')))
  requireCondition(artifact.metadata.sources['src/MonadSurf.sol'].keccak256 === sourceHash, 'Artefact périmé : recompiler le contrat avec Forge.')
  const data = encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [account.address] })
  const journal = 'contracts/broadcast/monad-testnet.json'
  await mkdir('contracts/broadcast', { recursive: true })
  let lock
  try { lock = await open(`${journal}.lock`, 'wx', 0o600) }
  catch (error) { if (error.code === 'EEXIST') throw new DeploymentError(`Un déploiement est verrouillé par ${journal}.lock.`); throw error }
  try {
    let state = JSON.parse(await readOptional(journal) || 'null')
    if (!state) {
      requireCondition(!process.env.NUXT_MONAD_CONTRACT_ADDRESS, 'Un contrat est déjà configuré ; vérifier son déploiement avant d’en créer un autre.')
      const estimate = await client.estimateGas({ account, data, value: 0n })
      const request = await wallet.prepareTransactionRequest({ data, value: 0n, gas: (estimate * 120n + 99n) / 100n })
      const maximumCost = request.gas * (request.maxFeePerGas ?? request.gasPrice)
      requireCondition(maximumCost <= parseEther(values['max-cost']), 'Le coût maximal dépasse --max-cost ; aucun envoi.')
      requireCondition(await client.getBalance({ address: account.address }) >= maximumCost, 'Solde insuffisant pour les frais maximaux.')
      console.log(`Monad testnet · relayer ${account.address} · frais maximaux ${formatEther(maximumCost)} MON`)
      if (!values.broadcast) { console.log('Simulation réussie. Ajouter --broadcast pour déployer.'); return }
      const raw = await wallet.signTransaction(request)
      state = { raw, hash: keccak256(raw) }
      // Conserver la même transaction signée permet de reprendre après une coupure sans redéployer.
      const file = await open(journal, 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(state, null, 2) + '\n'); await file.sync() }
      finally { await file.close() }
    }
    const transaction = parseTransaction(state.raw)
    requireCondition(transaction.chainId === 10143 && !transaction.to && (transaction.value ?? 0n) === 0n
      && transaction.data === data && state.hash === keccak256(state.raw)
      && await recoverTransactionAddress({ serializedTransaction: state.raw }) === account.address,
    'Le journal ne correspond pas au contrat, au réseau ou au wallet attendus.')
    const address = getContractAddress({ from: account.address, nonce: BigInt(transaction.nonce) })
    requireCondition(!process.env.NUXT_MONAD_CONTRACT_ADDRESS || getAddress(process.env.NUXT_MONAD_CONTRACT_ADDRESS) === address,
      'L’adresse configurée ne correspond pas au journal de déploiement.')
    console.log(`Transaction : ${state.hash}\nContrat attendu : ${address}`)
    if (!values.broadcast) return
    try { await wallet.sendRawTransaction({ serializedTransaction: state.raw }) }
    catch { console.log('Diffusion non confirmée par le RPC ; vérification de la transaction enregistrée.') }
    const receipt = await client.waitForTransactionReceipt({ hash: state.hash, confirmations: 2, timeout: 120000, pollingInterval: 1000 })
    requireCondition(receipt.status === 'success' && receipt.contractAddress?.toLowerCase() === address.toLowerCase()
      && getAddress(receipt.from) === account.address && receipt.to === null, 'Transaction échouée ou reçu inattendu ; conserver le journal pour diagnostic.')
    requireCondition((await client.getBlock({ blockNumber: receipt.blockNumber })).hash === receipt.blockHash, 'Le bloc du reçu a changé ; relancer la vérification.')
    let expectedCode = artifact.deployedBytecode.object.slice(2)
    for (const reference of Object.values(artifact.deployedBytecode.immutableReferences).flat()) {
      const start = reference.start * 2
      expectedCode = expectedCode.slice(0, start) + pad(account.address, { size: reference.length }).slice(2).toLowerCase() + expectedCode.slice(start + reference.length * 2)
    }
    requireCondition((await client.getCode({ address }))?.toLowerCase() === `0x${expectedCode}`.toLowerCase(), 'Le bytecode déployé diffère de l’artefact compilé.')
    const relayer = await client.readContract({ address, abi: artifact.abi, functionName: 'relayer' })
    requireCondition(getAddress(relayer) === account.address, 'Le relayer du contrat est incorrect.')
    const leaderboard = await client.readContract({ address, abi: artifact.abi, functionName: 'getLeaderboard' })
    const deployment = { chainId: 10143, contract: 'MonadSurf', address, relayer, transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(),
      compiler: artifact.metadata.compiler.version, sourceHash, bytecodeHash: keccak256(`0x${expectedCode}`) }
    await mkdir('contracts/deployments', { recursive: true })
    await writeFile('contracts/deployments/monad-testnet.json', JSON.stringify(deployment, null, 2) + '\n')
    let env = await readOptional('.env') || ''
    const setting = `NUXT_MONAD_CONTRACT_ADDRESS=${address}`
    env = /^NUXT_MONAD_CONTRACT_ADDRESS=.*$/m.test(env) ? env.replace(/^NUXT_MONAD_CONTRACT_ADDRESS=.*$/m, setting) : env.trimEnd() + '\n' + setting + '\n'
    const temporary = `.env.deploy-${process.pid}`
    await writeFile(temporary, env, { mode: 0o600, flag: 'wx' })
    await rename(temporary, '.env')
    console.log(`Déploiement vérifié : ${address}\nClassement : ${leaderboard.length} entrée(s). Adresse enregistrée dans .env et contracts/deployments/monad-testnet.json.`)
  } finally { await lock.close(); await unlink(`${journal}.lock`) }
}

try { await deploy() }
catch (error) {
  console.error(error instanceof DeploymentError ? error.message : 'Déploiement interrompu. Vérifier la configuration et le journal contracts/broadcast/monad-testnet.json avant de réessayer.')
  process.exitCode = 1
}
