#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadEnv } from './env.js';
import { initRandomKeypair } from './key-store.js';
import { jsonResult } from './result.js';
import { addressSchema, assetSchema, poolOrAllSchema, poolSchema } from './validation.js';
import {
  executeTransfer,
  executeWithdraw,
  getBalances,
  getDepositStatus,
  prepareDeposit,
  prepareRegister,
  subaccountStatus,
  veilStatus,
  waitForDeposit,
} from './veil.js';

loadEnv();

const server = new McpServer({
  name: 'veil-mcp',
  version: '0.1.0',
});

server.registerTool(
  'veil_init_keypair',
  {
    title: 'Initialize Veil Keypair',
    description:
      'Generate a random local Veil keypair and save VEIL_KEY/DEPOSIT_KEY to .env.veil. Returns the public deposit key but never returns VEIL_KEY.',
    inputSchema: {
      force: z.boolean().default(false).describe('Overwrite an existing .env.veil keypair.'),
    },
  },
  async ({ force }) => jsonResult(initRandomKeypair({ force })),
);

server.registerTool(
  'veil_status',
  {
    title: 'Veil Status',
    description:
      'Check local Veil key status, relay health, and optional owner registration/wallet status on Base.',
    inputSchema: {
      owner: addressSchema.optional().describe('Connected Base Account owner address from Base MCP get_wallets.'),
    },
  },
  async ({ owner }) => jsonResult(await veilStatus(owner as `0x${string}` | undefined)),
);

server.registerTool(
  'veil_get_balances',
  {
    title: 'Veil Balances',
    description:
      'Read public wallet balances, Veil queue balances, and private balances when VEIL_KEY is available.',
    inputSchema: {
      owner: addressSchema.describe('Connected Base Account owner address from Base MCP get_wallets.'),
      pool: poolOrAllSchema.describe('Pool to query.'),
    },
  },
  async ({ owner, pool }) => jsonResult(await getBalances({ owner: owner as `0x${string}`, pool })),
);

server.registerTool(
  'veil_deposit_status',
  {
    title: 'Veil Deposit Status',
    description:
      'Check a specific Veil queue deposit by pool and nonce. Use after Base MCP send_calls completes to track pending, accepted, rejected, or refunded state.',
    inputSchema: {
      owner: addressSchema.describe('Connected Base Account owner address from Base MCP get_wallets.'),
      pool: poolSchema.describe('Pool containing the deposit nonce.'),
      nonce: z.string().regex(/^\d+$/, 'nonce must be a non-negative integer string.').describe('Queue deposit nonce.'),
    },
  },
  async ({ owner, pool, nonce }) =>
    jsonResult(await getDepositStatus({ owner: owner as `0x${string}`, pool: pool as 'eth' | 'usdc', nonce })),
);

server.registerTool(
  'veil_wait_for_deposit',
  {
    title: 'Wait for Veil Deposit',
    description:
      'Poll a specific Veil queue deposit until it is accepted, rejected, refunded, or a timeout is reached.',
    inputSchema: {
      owner: addressSchema.describe('Connected Base Account owner address from Base MCP get_wallets.'),
      pool: poolSchema.describe('Pool containing the deposit nonce.'),
      nonce: z.string().regex(/^\d+$/, 'nonce must be a non-negative integer string.').describe('Queue deposit nonce.'),
      timeoutSeconds: z.number().int().min(1).max(1800).default(900),
      intervalSeconds: z.number().int().min(5).max(120).default(30),
    },
  },
  async ({ owner, pool, nonce, timeoutSeconds, intervalSeconds }) =>
    jsonResult(
      await waitForDeposit({
        owner: owner as `0x${string}`,
        pool: pool as 'eth' | 'usdc',
        nonce,
        timeoutSeconds,
        intervalSeconds,
      }),
    ),
);

server.registerTool(
  'veil_prepare_register',
  {
    title: 'Prepare Veil Register',
    description:
      'Build unsigned Base calldata to register or change the local Veil deposit key for the connected Base Account owner. Pass returned calls to Base MCP send_calls.',
    inputSchema: {
      owner: addressSchema.describe('Connected Base Account owner address from Base MCP get_wallets.'),
      force: z
        .boolean()
        .default(false)
        .describe('If true and owner is already registered, prepare changeDepositKey instead of register.'),
    },
  },
  async ({ owner, force }) => jsonResult(await prepareRegister({ owner: owner as `0x${string}`, force })),
);

server.registerTool(
  'veil_prepare_deposit',
  {
    title: 'Prepare Veil Deposit',
    description:
      'Build unsigned Base calldata for an ETH or USDC Veil deposit. USDC returns an ordered approve+deposit call batch. Pass returned calls to Base MCP send_calls.',
    inputSchema: {
      owner: addressSchema.describe('Connected Base Account owner address from Base MCP get_wallets.'),
      asset: assetSchema.describe('Asset to deposit.'),
      amount: z.string().min(1).describe('Net amount that should arrive in the Veil balance, e.g. "0.1".'),
    },
  },
  async ({ owner, asset, amount }) =>
    jsonResult(await prepareDeposit({ owner: owner as `0x${string}`, asset, amount })),
);

server.registerTool(
  'veil_withdraw',
  {
    title: 'Veil Withdraw',
    description:
      'Submit a private withdrawal through the Veil relay. Requires explicit user intent and confirm: true because this is not a Base MCP approval flow.',
    inputSchema: {
      asset: assetSchema.describe('Asset to withdraw.'),
      amount: z.string().min(1).describe('Amount to withdraw from the private pool.'),
      recipient: addressSchema.describe('Public recipient address.'),
      confirm: z
        .boolean()
        .describe('Must be true after the user explicitly confirms relay submission.'),
    },
  },
  async ({ asset, amount, recipient, confirm }) =>
    jsonResult(await executeWithdraw({ asset, amount, recipient: recipient as `0x${string}`, confirm })),
);

server.registerTool(
  'veil_transfer',
  {
    title: 'Veil Transfer',
    description:
      'Submit a private transfer through the Veil relay to another registered Veil user. Requires explicit user intent and confirm: true.',
    inputSchema: {
      asset: assetSchema.describe('Asset to transfer.'),
      amount: z.string().min(1).describe('Amount to transfer privately.'),
      recipient: addressSchema.describe('Registered recipient owner address.'),
      confirm: z
        .boolean()
        .describe('Must be true after the user explicitly confirms relay submission.'),
    },
  },
  async ({ asset, amount, recipient, confirm }) =>
    jsonResult(await executeTransfer({ asset, amount, recipient: recipient as `0x${string}`, confirm })),
);

server.registerTool(
  'veil_subaccount_status',
  {
    title: 'Veil Subaccount Status',
    description: 'Read Veil subaccount forwarder, queue, and private-balance status for a local Veil key slot.',
    inputSchema: {
      slot: z.number().int().min(0).describe('Subaccount slot index.'),
    },
  },
  async ({ slot }) => jsonResult(await subaccountStatus(slot)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('veil-mcp listening on stdio');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
