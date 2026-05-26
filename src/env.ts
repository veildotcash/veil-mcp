import dotenv from 'dotenv';

export const DEFAULT_RPC_URL = 'https://mainnet.base.org';
export const VEIL_ENV_PATH = '.env.veil';

export function loadEnv(): void {
  dotenv.config({ path: VEIL_ENV_PATH, quiet: true });
  dotenv.config({ quiet: true });
}

export function getRpcUrl(): string {
  return process.env.RPC_URL || DEFAULT_RPC_URL;
}

export function getRelayUrl(): string | undefined {
  return process.env.RELAY_URL;
}

export function getVeilKey(): `0x${string}` | undefined {
  const key = process.env.VEIL_KEY;
  if (!key) return undefined;
  return key as `0x${string}`;
}

export function getDepositKey(): `0x${string}` | undefined {
  const key = process.env.DEPOSIT_KEY;
  if (!key) return undefined;
  return key as `0x${string}`;
}

