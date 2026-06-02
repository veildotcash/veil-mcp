#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { payX402Resource } from '@veil-cash/sdk';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: resolve(root, '.env.veil'), quiet: true });
dotenv.config({ quiet: true });

const url = process.argv[2];
if (!url) {
  console.error('Usage: node scripts/pay-x402-once.mjs <url>');
  process.exit(1);
}

const veilKey = process.env.VEIL_KEY;
if (!veilKey) {
  console.error('VEIL_KEY missing in .env.veil');
  process.exit(1);
}

function reservePayerIndex() {
  const envPath = resolve(root, '.env.veil');
  const current = BigInt(process.env.X402_PAYER_INDEX || '0');
  const next = current + 1n;
  if (existsSync(envPath)) {
    let content = readFileSync(envPath, 'utf8');
    const line = `X402_PAYER_INDEX=${next.toString()}`;
    if (/^X402_PAYER_INDEX=/m.test(content)) {
      content = content.replace(/^X402_PAYER_INDEX=.*$/m, line);
    } else {
      content = `${content.trimEnd()}\n${line}\n`;
    }
    writeFileSync(envPath, content);
  }
  process.env.X402_PAYER_INDEX = next.toString();
  return current;
}

const payerIndex = reservePayerIndex();
const relayUrl =
  process.env.X402_RELAY_URL ||
  (process.env.RELAY_URL ? `${process.env.RELAY_URL.replace(/\/+$/, '')}/x402` : undefined);

console.log('Paying', url);
console.log('payerIndex', payerIndex.toString());
console.log('relayUrl', relayUrl);
console.log('rpcUrl', process.env.RPC_URL || '(default)');

const result = await payX402Resource({
  url,
  rootPrivateKey: veilKey,
  payerIndex,
  rpcUrl: process.env.RPC_URL,
  relayUrl,
  onProgress: (step, detail) => console.log(`[${step}]`, detail ?? ''),
});

const body = await result.response.text();
console.log(
  JSON.stringify(
    {
      success: result.response.ok,
      status: result.response.status,
      payerAddress: result.payerAddress,
      payerIndex: result.payerIndex,
      amount: result.amount,
      relayTransactionHash: result.relayTransactionHash,
      relayBlockNumber: result.relayBlockNumber,
      paymentTransactionHash: result.paymentTransactionHash,
      bodyPreview: body.slice(0, 800),
    },
    null,
    2,
  ),
);
