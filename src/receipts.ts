import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { VEIL_X402_RECEIPTS_PATH } from './env.js';

/**
 * Local, non-sensitive record of a single x402 payment. Stored on disk so an
 * agent can reconstruct its own spend history. Never contains VEIL_KEY, payer
 * private keys, proof arguments, nullifiers, encrypted outputs, x402 signatures,
 * or response bodies.
 */
export interface X402Receipt {
  timestamp: string;
  url: string;
  // 'funded' means the payer EOA was funded by the relay but the payment has not
  // yet completed; 'completed' means payX402Resource returned (success or not).
  stage: 'funded' | 'completed';
  success: boolean;
  settled: boolean | null;
  status: number;
  amount: string;
  amountAtomic: string;
  payerAddress: string;
  payerIndex: string;
  relayTransactionHash: string | null;
  paymentTransactionHash: string | null;
  // True when USDC may still sit on the payer EOA (funded but not delivered to
  // the merchant), recoverable from VEIL_KEY + payerIndex.
  recoverable: boolean;
  error?: string;
}

const MAX_RECEIPTS = 500;

function readReceiptsFile(path = VEIL_X402_RECEIPTS_PATH): X402Receipt[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as X402Receipt[]) : [];
  } catch {
    return [];
  }
}

function writeReceiptsFile(receipts: X402Receipt[], path = VEIL_X402_RECEIPTS_PATH): void {
  const dir = dirname(path);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(receipts, null, 2), { mode: 0o600 });
}

export function appendX402Receipt(receipt: X402Receipt, path = VEIL_X402_RECEIPTS_PATH): void {
  const receipts = readReceiptsFile(path);
  receipts.push(receipt);
  // Cap the log so it cannot grow without bound; keep the most recent entries.
  const trimmed = receipts.slice(-MAX_RECEIPTS);
  writeReceiptsFile(trimmed, path);
}

/**
 * Insert or update a receipt keyed by payerIndex. Each payment reserves a unique
 * payerIndex, so this lets a payment progress from a 'funded' record to a
 * 'completed' record without duplicating entries.
 */
export function upsertX402Receipt(receipt: X402Receipt, path = VEIL_X402_RECEIPTS_PATH): void {
  const receipts = readReceiptsFile(path);
  const existing = receipts.findIndex((r) => r.payerIndex === receipt.payerIndex);
  if (existing >= 0) {
    receipts[existing] = receipt;
    writeReceiptsFile(receipts, path);
    return;
  }
  receipts.push(receipt);
  const trimmed = receipts.slice(-MAX_RECEIPTS);
  writeReceiptsFile(trimmed, path);
}

export function listX402Receipts(options: { limit?: number } = {}, path = VEIL_X402_RECEIPTS_PATH): {
  count: number;
  totalSpentUsdc: string;
  receipts: X402Receipt[];
} {
  const all = readReceiptsFile(path);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_RECEIPTS);
  // Most recent first.
  const ordered = [...all].reverse().slice(0, limit);

  let totalAtomic = 0n;
  for (const receipt of all) {
    if (receipt.success && /^\d+$/.test(receipt.amountAtomic)) {
      totalAtomic += BigInt(receipt.amountAtomic);
    }
  }
  // USDC has 6 decimals.
  const whole = totalAtomic / 1_000_000n;
  const frac = (totalAtomic % 1_000_000n).toString().padStart(6, '0');

  return {
    count: all.length,
    totalSpentUsdc: `${whole}.${frac}`,
    receipts: ordered,
  };
}
