#!/usr/bin/env node

import './crypto-polyfill.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadEnv } from './env.js';
import { initRandomKeypair } from './key-store.js';
import { jsonResult } from './result.js';
import { addressSchema, assetSchema, poolOrAllSchema, poolSchema } from './validation.js';
import {
  consolidateUtxos,
  executeTransfer,
  executeWithdraw,
  getBalances,
  getDepositStatus,
  getX402PayerBalanceList,
  getX402Receipts,
  payX402,
  prepareDeposit,
  prepareRegister,
  quoteX402,
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
  'veil_pay_x402',
  {
    title: 'Pay x402 Resource',
    description:
      'Pay a Coinbase-compatible x402 resource from private Veil USDC. Supports GET and POST resources. Requires explicit user intent and confirm: true because it withdraws to a fresh payer EOA and submits payment. Set a tight maxPayment cap; the payment is rejected if the resource demands more.',
    inputSchema: {
      url: z.string().url().describe('x402-protected resource URL.'),
      method: z
        .enum(['GET', 'POST'])
        .default('GET')
        .describe('HTTP method for the resource request.'),
      body: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .optional()
        .describe('Request body for POST: a JSON object (sent as application/json) or a raw string. Only valid with method POST.'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Optional custom request headers.'),
      maxPayment: z
        .string()
        .regex(/^\d+(\.\d+)?$/, 'maxPayment must be a positive USDC decimal string, e.g. "0.10".')
        .optional()
        .describe('Maximum USDC to pay, as a decimal string like "0.10". Defaults to and is hard-capped at 10 USDC.'),
      payerIndex: z
        .string()
        .regex(/^\d+$/, 'payerIndex must be a non-negative integer string.')
        .optional()
        .describe('Reuse an already-funded payer EOA at this index (no new withdrawal). Use after a reuse_available result or to retry a funded-but-failed payment.'),
      forceFresh: z
        .boolean()
        .default(false)
        .describe('Skip the funded-payer reuse check and always withdraw to a new payer EOA.'),
      confirm: z
        .boolean()
        .describe('Must be true after the user explicitly confirms private USDC payment.'),
    },
  },
  async ({ url, method, body, headers, maxPayment, payerIndex, forceFresh, confirm }) =>
    jsonResult(await payX402({ url, method, body, headers, maxPayment, payerIndex, forceFresh, confirm })),
);

server.registerTool(
  'veil_x402_quote',
  {
    title: 'Quote x402 Resource',
    description:
      'Probe an x402 resource WITHOUT funding a payer or paying. Returns the price and payment requirement for a supported 402, or the raw status/body otherwise. Use before veil_pay_x402 to validate the request (method/body/headers) and confirm cost. Note: a merchant that only validates the request body after payment will still return 402 here.',
    inputSchema: {
      url: z.string().url().describe('x402-protected resource URL.'),
      method: z
        .enum(['GET', 'POST'])
        .default('GET')
        .describe('HTTP method for the resource request.'),
      body: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .optional()
        .describe('Request body for POST: a JSON object (sent as application/json) or a raw string. Only valid with method POST.'),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe('Optional custom request headers.'),
      maxPayment: z
        .string()
        .regex(/^\d+(\.\d+)?$/, 'maxPayment must be a positive USDC decimal string, e.g. "0.10".')
        .optional()
        .describe('Cap to compare the quoted price against. Defaults to and is hard-capped at 10 USDC.'),
    },
  },
  async ({ url, method, body, headers, maxPayment }) =>
    jsonResult(await quoteX402({ url, method, body, headers, maxPayment })),
);

server.registerTool(
  'veil_x402_receipts',
  {
    title: 'x402 Spend History',
    description:
      'List locally recorded x402 payment receipts (amount, payer address/index, relay and payment tx hashes, settlement status) and total USDC spent. Read-only; reconstructs this agent\'s own spend history.',
    inputSchema: {
      limit: z.number().int().min(1).max(500).default(50).describe('Maximum number of most-recent receipts to return.'),
    },
  },
  async ({ limit }) => jsonResult(getX402Receipts({ limit })),
);

server.registerTool(
  'veil_x402_payer_balances',
  {
    title: 'x402 Payer Balances',
    description:
      'Inspect Base USDC balances held by deterministic x402 payer EOAs over an index range. Surfaces dust or funds left on a payer after a failed payment. Read-only; does not move or reuse funds.',
    inputSchema: {
      startIndex: z
        .string()
        .regex(/^\d+$/, 'startIndex must be a non-negative integer string.')
        .default('0')
        .describe('First payer index to inspect.'),
      count: z.number().int().min(1).max(256).default(16).describe('How many payer indexes to inspect from startIndex.'),
      nonZeroOnly: z.boolean().default(false).describe('Only return payers that currently hold USDC.'),
    },
  },
  async ({ startIndex, count, nonZeroOnly }) =>
    jsonResult(await getX402PayerBalanceList({ startIndex, count, nonZeroOnly })),
);

server.registerTool(
  'veil_consolidate_utxos',
  {
    title: 'Consolidate Private UTXOs',
    description:
      'Merge fragmented private UTXOs into fewer notes via a self-transfer through the Veil relay. A single transaction consumes at most 16 input UTXOs, so heavy x402 usage can fragment a balance until it cannot be spent in full. Requires explicit user intent and confirm: true. May need multiple rounds when more than 16 UTXOs are unspent.',
    inputSchema: {
      asset: assetSchema.describe('Asset to consolidate.'),
      amount: z
        .string()
        .regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string.')
        .optional()
        .describe('Optional target amount to consolidate. Omit to merge as much as possible (up to 16 notes) in one round.'),
      confirm: z
        .boolean()
        .describe('Must be true after the user explicitly confirms relay submission.'),
    },
  },
  async ({ asset, amount, confirm }) => jsonResult(await consolidateUtxos({ asset, amount, confirm })),
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
