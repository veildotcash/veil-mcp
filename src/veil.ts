import {
  ENTRY_ABI,
  ERC20_ABI,
  POOL_CONFIG,
  QUEUE_ABI,
  buildApproveUSDCTx,
  buildChangeDepositKeyTx,
  buildDepositETHTx,
  buildDepositUSDCTx,
  buildRegisterTx,
  checkRelayHealth,
  getAddresses,
  getDailyFreeRemaining,
  getPrivateBalance,
  getQueueAddress,
  getQueueBalance,
  getSubaccountStatus,
  getX402PayerBalances,
  mergeUtxos,
  payX402Resource,
  transfer,
  withdraw,
} from '@veil-cash/sdk';
import { createPublicClient, formatEther, formatUnits, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { asBaseCall, sendCalls, toHexValue } from './base.js';
import { DEFAULT_RPC_URL, getRelayUrl, getRpcUrl, getX402RelayUrl } from './env.js';
import { getKeyStatus, maskHex, requireDepositKey, requireKeypair, reserveX402PayerIndex } from './key-store.js';
import { listX402Receipts, upsertX402Receipt } from './receipts.js';
import type { X402PayerFundedInfo } from '@veil-cash/sdk';
import type { Asset, Hex, Pool, SendCallsPayload, StepCall } from './types.js';

const MINIMUM_NET: Record<Asset, number> = {
  ETH: 0.01,
  USDC: 10,
};

// Hard ceiling on a single x402 payment, regardless of caller-supplied cap. A
// protective backstop so an autonomous agent cannot drain large amounts if a
// merchant raises prices unexpectedly. Callers should still set a tighter
// per-request maxPayment.
const X402_MAX_PAYMENT_USDC = 10;

// The pool's transaction16 circuit caps a single transaction at 16 input UTXOs.
// Beyond this, a full-balance withdraw/payment cannot be built without first
// consolidating.
const MAX_INPUT_UTXOS = 16;

const DEPOSIT_STATUS_MAP: Record<number, 'pending' | 'accepted' | 'rejected' | 'refunded'> = {
  0: 'pending',
  1: 'accepted',
  2: 'rejected',
  3: 'refunded',
};

function publicClient(rpcUrl = getRpcUrl()) {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

export async function isRegistered(owner: Hex, rpcUrl = getRpcUrl()): Promise<{
  registered: boolean;
  depositKey: Hex | null;
}> {
  const depositKey = (await publicClient(rpcUrl).readContract({
    address: getAddresses().entry,
    abi: ENTRY_ABI,
    functionName: 'depositKeys',
    args: [owner],
  })) as Hex;

  const registered = Boolean(depositKey && depositKey !== '0x' && depositKey.length > 2);
  return {
    registered,
    depositKey: registered ? depositKey : null,
  };
}

async function getWalletBalances(owner: Hex, rpcUrl = getRpcUrl()): Promise<{
  eth: string;
  ethWei: string;
  usdc: string;
  usdcWei: string;
}> {
  const addresses = getAddresses();
  const [ethBalance, usdcBalance] = await Promise.all([
    publicClient(rpcUrl).getBalance({ address: owner }),
    publicClient(rpcUrl).readContract({
      address: addresses.usdcToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [owner],
    }) as Promise<bigint>,
  ]);

  return {
    eth: formatUnits(ethBalance, POOL_CONFIG.eth.decimals),
    ethWei: ethBalance.toString(),
    usdc: formatUnits(usdcBalance, POOL_CONFIG.usdc.decimals),
    usdcWei: usdcBalance.toString(),
  };
}

async function getGrossAmount(options: {
  netWei: bigint;
  owner: Hex;
  pool: Pool;
  rpcUrl?: string;
}): Promise<{ grossWei: bigint; feeWei: bigint; dailyFreeUsed: boolean; dailyFreeRemaining: number }> {
  const freeRemaining = await getDailyFreeRemaining({
    address: options.owner,
    pool: options.pool,
    rpcUrl: options.rpcUrl,
  });
  if (freeRemaining > 0) {
    return {
      grossWei: options.netWei,
      feeWei: 0n,
      dailyFreeUsed: true,
      dailyFreeRemaining: freeRemaining - 1,
    };
  }

  const grossWei = (await publicClient(options.rpcUrl).readContract({
    address: getAddresses().entry,
    abi: ENTRY_ABI,
    functionName: 'getDepositAmountWithFee',
    args: [options.netWei],
  })) as bigint;

  return {
    grossWei,
    feeWei: grossWei - options.netWei,
    dailyFreeUsed: false,
    dailyFreeRemaining: 0,
  };
}

export async function veilStatus(owner?: Hex): Promise<Record<string, unknown>> {
  const rpcUrl = getRpcUrl();
  const keyStatus = getKeyStatus();
  let registration: Record<string, unknown> = { checked: false };
  let wallet: Record<string, unknown> | null = null;

  if (owner) {
    const reg = await isRegistered(owner, rpcUrl);
    registration = {
      checked: true,
      registered: reg.registered,
      keysMatch: Boolean(
        reg.depositKey &&
          keyStatus.depositKey &&
          reg.depositKey.toLowerCase() === keyStatus.depositKey.toLowerCase(),
      ),
      onChainDepositKey: reg.depositKey ? maskHex(reg.depositKey) : null,
    };
    wallet = await getWalletBalances(owner, rpcUrl);
  }

  let relay: Record<string, unknown>;
  try {
    const health = await checkRelayHealth(getRelayUrl());
    relay = {
      checked: true,
      healthy: health.status === 'ok',
      status: health.status,
      network: health.network,
    };
  } catch (error) {
    relay = {
      checked: true,
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown relay error',
    };
  }

  return {
    chain: 'base',
    chainId: getAddresses().chainId,
    owner: owner || null,
    rpcUrl: process.env.RPC_URL ? maskUrl(rpcUrl) : DEFAULT_RPC_URL,
    wallet,
    veilKey: { found: keyStatus.veilKeyFound },
    depositKey: {
      found: keyStatus.depositKeyFound,
      key: keyStatus.maskedDepositKey || null,
    },
    registration,
    relay,
  };
}

interface UtxoDetail {
  index: number;
  amount: string;
  amountWei: string;
  isSpent: boolean;
}

function summarizeFragmentation(utxos: UtxoDetail[], pool: Pool): Record<string, unknown> {
  const unspent = utxos.filter((u) => !u.isSpent);
  const sorted = [...unspent].sort((a, b) => (BigInt(b.amountWei) > BigInt(a.amountWei) ? 1 : -1));
  const decimals = POOL_CONFIG[pool].decimals;

  return {
    unspentCount: unspent.length,
    maxInputsPerTransaction: MAX_INPUT_UTXOS,
    // A single withdraw/transfer/payment can consume at most MAX_INPUT_UTXOS
    // notes, so a balance fragmented beyond that cannot be spent in full until
    // consolidated via veil_consolidate_utxos.
    needsConsolidation: unspent.length > MAX_INPUT_UTXOS,
    largestUtxo: sorted.length > 0 ? sorted[0].amount : null,
    smallestUtxo: sorted.length > 0 ? sorted[sorted.length - 1].amount : null,
    unspentUtxos: sorted.map((u) => ({ index: u.index, amount: u.amount, amountWei: u.amountWei })),
    decimals,
  };
}

export async function getBalances(options: {
  owner: Hex;
  pool?: Pool | 'all';
}): Promise<Record<string, unknown>> {
  const rpcUrl = getRpcUrl();
  const poolNames: Pool[] = options.pool && options.pool !== 'all' ? [options.pool] : ['eth', 'usdc'];
  const keypair = getKeyStatus().veilKeyFound ? requireKeypair() : null;
  const wallet = await getWalletBalances(options.owner, rpcUrl);

  const pools = await Promise.all(
    poolNames.map(async (pool) => {
      const queue = await getQueueBalance({ address: options.owner, pool, rpcUrl });
      const privateBalance = keypair ? await getPrivateBalance({ keypair, pool, rpcUrl }) : null;
      const privateWei = privateBalance ? BigInt(privateBalance.privateBalanceWei) : 0n;
      const queueWei = BigInt(queue.queueBalanceWei);
      const totalWei = privateWei + queueWei;

      return {
        pool,
        symbol: POOL_CONFIG[pool].symbol,
        totalBalance: formatUnits(totalWei, POOL_CONFIG[pool].decimals),
        totalBalanceWei: totalWei.toString(),
        queue: {
          balance: queue.queueBalance,
          balanceWei: queue.queueBalanceWei,
          count: queue.pendingCount,
          deposits: queue.pendingDeposits,
        },
        private: privateBalance
          ? {
              balance: privateBalance.privateBalance,
              balanceWei: privateBalance.privateBalanceWei,
              utxoCount: privateBalance.utxoCount,
              unspentCount: privateBalance.unspentCount,
              spentCount: privateBalance.spentCount,
              fragmentation: summarizeFragmentation(privateBalance.utxos, pool),
            }
          : {
              balance: null,
              note: 'Set VEIL_KEY or call veil_init_keypair to see private balance.',
            },
      };
    }),
  );

  return {
    chain: 'base',
    owner: options.owner,
    wallet,
    pools,
  };
}

export async function getDepositStatus(options: {
  owner: Hex;
  pool: Pool;
  nonce: string;
}): Promise<Record<string, unknown>> {
  if (!/^\d+$/.test(options.nonce)) {
    throw new Error('nonce must be a non-negative integer string.');
  }

  const queueAddress = getQueueAddress(options.pool);
  const poolConfig = POOL_CONFIG[options.pool];
  const deposit = (await publicClient().readContract({
    address: queueAddress,
    abi: QUEUE_ABI,
    functionName: 'getDeposit',
    args: [BigInt(options.nonce)],
  })) as {
    fallbackReceiver: Hex;
    amountIn: bigint;
    fee: bigint;
    shieldAmount: bigint;
    timestamp: bigint;
    status: number;
    depositKey: Hex;
  };

  const status = DEPOSIT_STATUS_MAP[deposit.status] || 'pending';
  const belongsToOwner = deposit.fallbackReceiver.toLowerCase() === options.owner.toLowerCase();

  // For still-pending deposits, surface the position in the processing queue and
  // a typical processing time so an agent can decide how long to wait.
  let queuePosition: number | null = null;
  let queueLength: number | null = null;
  if (status === 'pending') {
    try {
      const pendingNonces = (await publicClient().readContract({
        address: queueAddress,
        abi: QUEUE_ABI,
        functionName: 'getPendingDeposits',
      })) as bigint[];
      queueLength = pendingNonces.length;
      const idx = pendingNonces.findIndex((n) => n.toString() === options.nonce);
      // 1-based position; deposits are processed in FIFO order.
      queuePosition = idx >= 0 ? idx + 1 : null;
    } catch {
      queuePosition = null;
      queueLength = null;
    }
  }

  return {
    chain: 'base',
    owner: options.owner,
    pool: options.pool,
    nonce: options.nonce,
    queueAddress,
    belongsToOwner,
    status,
    terminal: status !== 'pending',
    queuePosition,
    queueLength,
    typicalProcessingMinutes: status === 'pending' ? '8-12' : null,
    amountIn: formatUnits(deposit.amountIn, poolConfig.decimals),
    amountInWei: deposit.amountIn.toString(),
    fee: formatUnits(deposit.fee, poolConfig.decimals),
    feeWei: deposit.fee.toString(),
    shieldAmount: formatUnits(deposit.shieldAmount, poolConfig.decimals),
    shieldAmountWei: deposit.shieldAmount.toString(),
    fallbackReceiver: deposit.fallbackReceiver,
    timestamp: new Date(Number(deposit.timestamp) * 1000).toISOString(),
  };
}

export async function waitForDeposit(options: {
  owner: Hex;
  pool: Pool;
  nonce: string;
  timeoutSeconds?: number;
  intervalSeconds?: number;
}): Promise<Record<string, unknown>> {
  const timeoutSeconds = Math.min(Math.max(options.timeoutSeconds ?? 900, 1), 1800);
  const intervalSeconds = Math.min(Math.max(options.intervalSeconds ?? 30, 5), 120);
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatus = await getDepositStatus(options);

  while (lastStatus.status === 'pending' && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalSeconds * 1000, remaining)));
    lastStatus = await getDepositStatus(options);
  }

  return {
    ...lastStatus,
    timedOut: lastStatus.status === 'pending',
    timeoutSeconds,
    intervalSeconds,
  };
}

export async function prepareRegister(options: { owner: Hex; force?: boolean }): Promise<
  SendCallsPayload & {
    action: 'register' | 'changeDepositKey' | 'alreadyRegistered';
    owner: Hex;
    alreadyRegistered: boolean;
    keysMatch: boolean;
  }
> {
  const depositKey = requireDepositKey();
  const reg = await isRegistered(options.owner);
  const keysMatch = Boolean(reg.depositKey && reg.depositKey.toLowerCase() === depositKey.toLowerCase());

  if (reg.registered && keysMatch && !options.force) {
    return {
      ...sendCalls([]),
      action: 'alreadyRegistered',
      owner: options.owner,
      alreadyRegistered: true,
      keysMatch: true,
    };
  }

  if (reg.registered && !keysMatch && !options.force) {
    throw new Error('Owner is already registered with a different deposit key. Re-call with force: true to prepare changeDepositKey.');
  }

  const isChange = Boolean(options.force && reg.registered);
  const tx = isChange
    ? buildChangeDepositKeyTx(depositKey, options.owner)
    : buildRegisterTx(depositKey, options.owner);

  return {
    ...sendCalls([asBaseCall(tx)]),
    action: isChange ? 'changeDepositKey' : 'register',
    owner: options.owner,
    alreadyRegistered: reg.registered,
    keysMatch,
  };
}

export async function prepareDeposit(options: { owner: Hex; asset: Asset; amount: string }): Promise<
  SendCallsPayload & {
    owner: Hex;
    asset: Asset;
    netAmount: string;
    grossAmount: string;
    fee: string;
    dailyFreeUsed: boolean;
    dailyFreeRemaining: number;
    steps: StepCall[];
  }
> {
  const amountNum = Number(options.amount);
  if (!Number.isFinite(amountNum) || amountNum < MINIMUM_NET[options.asset]) {
    throw new Error(`Minimum deposit is ${MINIMUM_NET[options.asset]} ${options.asset}.`);
  }

  const depositKey = requireDepositKey();
  const pool = options.asset.toLowerCase() as Pool;
  const decimals = POOL_CONFIG[pool].decimals;
  const netWei = options.asset === 'ETH' ? parseEther(options.amount) : parseUnits(options.amount, decimals);
  const gross = await getGrossAmount({ netWei, owner: options.owner, pool });
  const grossAmount = options.asset === 'ETH' ? formatEther(gross.grossWei) : formatUnits(gross.grossWei, decimals);
  const fee = options.asset === 'ETH' ? formatEther(gross.feeWei) : formatUnits(gross.feeWei, decimals);

  const steps: StepCall[] = [];
  if (options.asset === 'USDC') {
    const approveTx = buildApproveUSDCTx({ amount: grossAmount });
    steps.push({ step: 'approve', ...asBaseCall(approveTx) });
    const depositTx = buildDepositUSDCTx({ depositKey, amount: grossAmount });
    steps.push({ step: 'deposit', ...asBaseCall(depositTx) });
  } else {
    const depositTx = buildDepositETHTx({ depositKey, amount: grossAmount });
    steps.push({
      step: 'deposit',
      to: depositTx.to,
      value: toHexValue(depositTx.value),
      data: depositTx.data,
    });
  }

  return {
    ...sendCalls(steps.map(({ step: _step, ...call }) => call)),
    owner: options.owner,
    asset: options.asset,
    netAmount: options.amount,
    grossAmount,
    fee,
    dailyFreeUsed: gross.dailyFreeUsed,
    dailyFreeRemaining: gross.dailyFreeRemaining,
    steps,
  };
}

export async function executeWithdraw(options: {
  asset: Asset;
  amount: string;
  recipient: Hex;
  confirm: boolean;
}): Promise<Record<string, unknown>> {
  if (!options.confirm) {
    throw new Error('Withdraw submits through the Veil relay. Re-call with confirm: true after explicit user approval.');
  }

  const result = await withdraw({
    amount: options.amount,
    recipient: options.recipient,
    keypair: requireKeypair(),
    pool: options.asset.toLowerCase() as Pool,
    rpcUrl: getRpcUrl(),
  });

  return {
    success: result.success,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    asset: options.asset,
    amount: result.amount,
    recipient: result.recipient,
    type: 'withdraw',
  };
}

export async function executeTransfer(options: {
  asset: Asset;
  amount: string;
  recipient: Hex;
  confirm: boolean;
}): Promise<Record<string, unknown>> {
  if (!options.confirm) {
    throw new Error('Transfer submits through the Veil relay. Re-call with confirm: true after explicit user approval.');
  }

  const result = await transfer({
    amount: options.amount,
    recipientAddress: options.recipient,
    senderKeypair: requireKeypair(),
    pool: options.asset.toLowerCase() as Pool,
    rpcUrl: getRpcUrl(),
  });

  return {
    success: result.success,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    asset: options.asset,
    amount: result.amount,
    recipient: result.recipient,
    type: 'transfer',
  };
}

export async function consolidateUtxos(options: {
  asset: Asset;
  amount?: string;
  confirm: boolean;
}): Promise<Record<string, unknown>> {
  if (!options.confirm) {
    throw new Error('Consolidation submits a self-transfer through the Veil relay. Re-call with confirm: true after explicit user approval.');
  }

  const keypair = requireKeypair();
  const pool = options.asset.toLowerCase() as Pool;
  const rpcUrl = getRpcUrl();
  const decimals = POOL_CONFIG[pool].decimals;

  const balance = await getPrivateBalance({ keypair, pool, rpcUrl });
  const unspent = balance.utxos.filter((u) => !u.isSpent);
  if (unspent.length < 2) {
    throw new Error('Nothing to consolidate: need at least 2 unspent UTXOs.');
  }

  // Largest-first to mirror the SDK UTXO selection ordering so a target amount
  // selects a predictable set of notes.
  const sorted = [...unspent].sort((a, b) => (BigInt(b.amountWei) > BigInt(a.amountWei) ? 1 : -1));

  let amount: string;
  let mergedInputs: number;
  if (options.amount !== undefined) {
    amount = options.amount;
    // Estimate how many notes a largest-first selection will consume to surface
    // the 16-input ceiling before submitting.
    const targetWei = parseUnits(options.amount, decimals);
    let acc = 0n;
    mergedInputs = 0;
    for (const u of sorted) {
      acc += BigInt(u.amountWei);
      mergedInputs++;
      if (acc >= targetWei) break;
    }
    if (acc < targetWei) {
      throw new Error(`Insufficient unspent balance to consolidate ${options.amount} ${options.asset}.`);
    }
    if (mergedInputs > MAX_INPUT_UTXOS) {
      throw new Error(
        `Consolidating ${options.amount} ${options.asset} needs ${mergedInputs} input UTXOs, above the ${MAX_INPUT_UTXOS}-input limit. Consolidate a smaller amount first.`,
      );
    }
  } else {
    // No target: consolidate as much as possible in one round, capped at the
    // 16-input circuit limit. Merge the largest notes so each round reduces the
    // unspent count by up to 15.
    const cap = Math.min(MAX_INPUT_UTXOS, unspent.length);
    const selected = sorted.slice(0, cap);
    let sumWei = 0n;
    for (const u of selected) sumWei += BigInt(u.amountWei);
    amount = formatUnits(sumWei, decimals);
    mergedInputs = cap;
  }

  const result = await mergeUtxos({ amount, keypair, pool, rpcUrl });

  const unspentAfter = unspent.length - mergedInputs + 1;
  return {
    type: 'consolidate',
    success: result.success,
    transactionHash: result.transactionHash,
    blockNumber: result.blockNumber,
    asset: options.asset,
    amountConsolidated: amount,
    mergedInputs,
    unspentBefore: unspent.length,
    unspentAfter,
    needsAnotherRound: unspentAfter > MAX_INPUT_UTXOS,
    note:
      unspentAfter > MAX_INPUT_UTXOS
        ? `Still fragmented beyond the ${MAX_INPUT_UTXOS}-input limit. Run veil_consolidate_utxos again to merge further.`
        : 'Private balance can now be spent in a single transaction.',
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text) {
    return null;
  }
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

export async function payX402(options: {
  url: string;
  maxPayment?: string;
  confirm: boolean;
}): Promise<Record<string, unknown>> {
  if (!options.confirm) {
    throw new Error('x402 payment withdraws private USDC to a fresh payer and submits payment. Re-call with confirm: true after explicit user approval.');
  }

  const keypair = requireKeypair();
  const rootPrivateKey = keypair.privkey;
  if (!rootPrivateKey) {
    throw new Error('VEIL_KEY missing. Call veil_init_keypair first or provide VEIL_KEY in .env.veil.');
  }

  // Clamp the caller-supplied cap to the protective backstop. A caller can set a
  // tighter cap, but never a looser one than X402_MAX_PAYMENT_USDC.
  const requestedCap = options.maxPayment !== undefined ? Number(options.maxPayment) : X402_MAX_PAYMENT_USDC;
  if (!Number.isFinite(requestedCap) || requestedCap <= 0) {
    throw new Error('maxPayment must be a positive USDC amount, e.g. "0.10".');
  }
  const effectiveCap = Math.min(requestedCap, X402_MAX_PAYMENT_USDC);

  const payerIndex = reserveX402PayerIndex();

  // Capture the funded state so a receipt exists even if a later step (signing,
  // the second fetch, settle-header parse, body read) throws and strands funds
  // on the payer EOA.
  let fundedInfo: X402PayerFundedInfo | null = null;

  let result: Awaited<ReturnType<typeof payX402Resource>>;
  try {
    result = await payX402Resource({
      url: options.url,
      rootPrivateKey: rootPrivateKey as `0x${string}`,
      payerIndex,
      rpcUrl: getRpcUrl(),
      relayUrl: getX402RelayUrl(),
      maxPayment: String(effectiveCap),
      onPayerFunded: (info) => {
        fundedInfo = info;
        upsertX402Receipt({
          timestamp: new Date().toISOString(),
          url: options.url,
          stage: 'funded',
          success: false,
          settled: null,
          status: 0,
          amount: info.amount,
          amountAtomic: info.amountAtomic,
          payerAddress: info.payerAddress,
          payerIndex: info.payerIndex,
          relayTransactionHash: info.relayTransactionHash || null,
          paymentTransactionHash: null,
          recoverable: true,
        });
      },
    });
  } catch (error) {
    // If the payer was funded before the failure, keep the funded receipt and
    // annotate it so the stranded funds remain discoverable for recovery.
    if (fundedInfo) {
      const info = fundedInfo as X402PayerFundedInfo;
      upsertX402Receipt({
        timestamp: new Date().toISOString(),
        url: options.url,
        stage: 'funded',
        success: false,
        settled: null,
        status: 0,
        amount: info.amount,
        amountAtomic: info.amountAtomic,
        payerAddress: info.payerAddress,
        payerIndex: info.payerIndex,
        relayTransactionHash: info.relayTransactionHash || null,
        paymentTransactionHash: null,
        recoverable: true,
        error: error instanceof Error ? error.message : 'x402 payment failed after funding',
      });
    }
    throw error;
  }

  const body = await readResponseBody(result.response);

  // Report success from the x402 settlement result, not just the HTTP status.
  // A spec-compliant facilitator returns 402 when settlement fails, but a 2xx
  // response whose settle header explicitly reports failure must not be treated
  // as a successful payment.
  const settled = result.paymentResponse?.success ?? null;
  const success = result.response.ok && settled !== false;

  // Finalize the receipt for this payerIndex. A completed-but-unsettled payment
  // may still have funds on the payer, so mark it recoverable in that case.
  upsertX402Receipt({
    timestamp: new Date().toISOString(),
    url: options.url,
    stage: 'completed',
    success,
    settled,
    status: result.response.status,
    amount: result.amount,
    amountAtomic: result.amountAtomic,
    payerAddress: result.payerAddress,
    payerIndex: result.payerIndex,
    relayTransactionHash: result.relayTransactionHash || null,
    paymentTransactionHash: result.paymentTransactionHash || null,
    recoverable: !success,
  });

  return {
    success,
    settled,
    status: result.response.status,
    url: options.url,
    maxPayment: String(effectiveCap),
    receipt: {
      payerAddress: result.payerAddress,
      payerIndex: result.payerIndex,
      amount: result.amount,
      amountAtomic: result.amountAtomic,
      relayTransactionHash: result.relayTransactionHash || null,
      paymentTransactionHash: result.paymentTransactionHash || null,
    },
    payerAddress: result.payerAddress,
    payerIndex: result.payerIndex,
    amount: result.amount,
    amountAtomic: result.amountAtomic,
    relayTransactionHash: result.relayTransactionHash || null,
    relayBlockNumber: result.relayBlockNumber || null,
    paymentTransactionHash: result.paymentTransactionHash || null,
    body,
    type: 'x402_payment',
  };
}

export function getX402Receipts(options: { limit?: number } = {}): Record<string, unknown> {
  const { count, totalSpentUsdc, receipts } = listX402Receipts({ limit: options.limit });
  return {
    type: 'x402_receipts',
    count,
    totalSpentUsdc,
    receipts,
  };
}

export async function getX402PayerBalanceList(options: {
  startIndex?: string;
  count?: number;
  nonZeroOnly?: boolean;
}): Promise<Record<string, unknown>> {
  const keypair = requireKeypair();
  const rootPrivateKey = keypair.privkey;
  if (!rootPrivateKey) {
    throw new Error('VEIL_KEY missing. Call veil_init_keypair first or provide VEIL_KEY in .env.veil.');
  }

  const balances = await getX402PayerBalances({
    rootPrivateKey: rootPrivateKey as `0x${string}`,
    startIndex: options.startIndex ?? '0',
    count: options.count ?? 16,
    nonZeroOnly: options.nonZeroOnly ?? false,
    rpcUrl: getRpcUrl(),
  });

  let totalAtomic = 0n;
  for (const balance of balances) {
    totalAtomic += BigInt(balance.usdcAtomic);
  }

  return {
    type: 'x402_payer_balances',
    startIndex: options.startIndex ?? '0',
    count: balances.length,
    totalUsdc: formatUnits(totalAtomic, POOL_CONFIG.usdc.decimals),
    totalUsdcAtomic: totalAtomic.toString(),
    note: 'Funds left on a payer EOA are recoverable from VEIL_KEY + payerIndex. This MCP does not yet sweep payers automatically.',
    payers: balances,
  };
}

export async function subaccountStatus(slot: number): Promise<Record<string, unknown>> {
  const veilKey = getKeyStatus().veilKeyFound ? requireKeypair().privkey : null;
  if (!veilKey) {
    throw new Error('VEIL_KEY missing. Call veil_init_keypair first or provide VEIL_KEY in .env.veil.');
  }

  const status = await getSubaccountStatus({
    rootPrivateKey: veilKey as `0x${string}`,
    slot,
    rpcUrl: getRpcUrl(),
  });

  return {
    slot: status.slot.slot,
    forwarderAddress: status.slot.forwarderAddress,
    childOwner: status.slot.childOwner,
    childDepositKey: maskHex(status.slot.childDepositKey),
    deployed: status.deployed,
    balances: status.balances,
    privateBalances: status.privateBalances,
    queues: status.queues,
  };
}

function maskUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return maskHex(url);
  }
}
