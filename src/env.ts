import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import dotenv from 'dotenv';

export const DEFAULT_RPC_URL = 'https://mainnet.base.org';
export const VEIL_ENV_PATH = '.env.veil';

export function loadEnv(): void {
  // Try CWD first (original behavior)
  dotenv.config({ path: VEIL_ENV_PATH, quiet: true });

  // Fallback: $HOME/.env.veil (common when MCP clients launch from arbitrary CWD)
  const homePath = join(homedir(), '.env.veil');
  if (!process.env.VEIL_KEY && existsSync(homePath)) {
    dotenv.config({ path: homePath, quiet: true });
  }

  // Final fallback: standard .env
  dotenv.config({ quiet: true });
}

/**
 * Emit startup diagnostics to stderr so MCP client logs capture
 * configuration issues without polluting the JSON-RPC stdio channel.
 */
export function logStartupDiagnostics(): void {
  if (!process.env.VEIL_KEY) {
    console.error(
      '[veil-mcp] warning: VEIL_KEY not found. Private balance reads and relay actions will fail. ' +
        'Set VEIL_KEY via env config in your MCP client, or place .env.veil in CWD or $HOME.',
    );
  }

  if (!process.env.DEPOSIT_KEY && !process.env.VEIL_KEY) {
    console.error(
      '[veil-mcp] warning: DEPOSIT_KEY not found. Registration and deposit calldata cannot be prepared. ' +
        'Run veil_init_keypair to generate a keypair.',
    );
  }

  if (!process.env.RPC_URL) {
    console.error(
      `[veil-mcp] notice: RPC_URL not set — using public ${DEFAULT_RPC_URL}. ` +
        'Merkle tree reads may be rate-limited. Set RPC_URL to a dedicated Base RPC endpoint.',
    );
  }
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
