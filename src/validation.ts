import { z } from 'zod';

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x-prefixed Ethereum address');

export const assetSchema = z.enum(['ETH', 'USDC']);
export const poolSchema = z.enum(['eth', 'usdc']);
export const poolOrAllSchema = z.enum(['eth', 'usdc', 'all']).default('all');

export function normalizeAsset(asset: string): 'ETH' | 'USDC' {
  const normalized = asset.toUpperCase();
  if (normalized !== 'ETH' && normalized !== 'USDC') {
    throw new Error(`Unsupported asset: ${asset}. Supported: ETH, USDC`);
  }
  return normalized;
}

export function normalizePool(pool: string): 'eth' | 'usdc' {
  const normalized = pool.toLowerCase();
  if (normalized !== 'eth' && normalized !== 'usdc') {
    throw new Error(`Unsupported pool: ${pool}. Supported: eth, usdc`);
  }
  return normalized;
}

