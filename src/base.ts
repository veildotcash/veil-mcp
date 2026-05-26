import type { BaseCall, Hex, SendCallsPayload } from './types.js';

export function toHexValue(value: bigint | string | number | undefined | null): Hex {
  if (value === undefined || value === null) return '0x0';
  if (typeof value === 'bigint') return `0x${value.toString(16)}` as Hex;
  if (typeof value === 'number') return `0x${BigInt(value).toString(16)}` as Hex;
  if (value.startsWith('0x')) return value as Hex;
  return `0x${BigInt(value).toString(16)}` as Hex;
}

export function asBaseCall(tx: { to: Hex; data: Hex; value?: bigint | string | number }): BaseCall {
  return {
    to: tx.to,
    value: toHexValue(tx.value),
    data: tx.data,
  };
}

export function sendCalls(calls: BaseCall[]): SendCallsPayload {
  return {
    chain: 'base',
    calls,
  };
}

