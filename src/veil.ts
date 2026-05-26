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
  transfer,
  withdraw,
} from '@veil-cash/sdk';
import { createPublicClient, formatEther, formatUnits, http, parseEther, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { asBaseCall, sendCalls, toHexValue } from './base.js';
import { DEFAULT_RPC_URL, getRelayUrl, getRpcUrl } from './env.js';
import { getKeyStatus, maskHex, requireDepositKey, requireKeypair } from './key-store.js';
import type { Asset, Hex, Pool, SendCallsPayload, StepCall } from './types.js';

const MINIMUM_NET: Record<Asset, number> = {
  ETH: 0.01,
  USDC: 10,
};

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

  return {
    chain: 'base',
    owner: options.owner,
    pool: options.pool,
    nonce: options.nonce,
    queueAddress,
    belongsToOwner,
    status,
    terminal: status !== 'pending',
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
