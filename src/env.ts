import dotenv from 'dotenv';

export const DEFAULT_RPC_URL = 'https://mainnet.base.org';
export const VEIL_ENV_PATH = '.env.veil';
export const VEIL_X402_RECEIPTS_PATH = '.veil-x402-receipts.json';

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

function appendPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function getX402RelayUrl(): string | undefined {
  if (process.env.X402_RELAY_URL) {
    return process.env.X402_RELAY_URL;
  }
  if (process.env.RELAY_URL) {
    return appendPath(process.env.RELAY_URL, '/x402');
  }
  return 'https://veil-relay.up.railway.app/x402';
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

