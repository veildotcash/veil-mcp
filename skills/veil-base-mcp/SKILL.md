---
name: veil-base-mcp
version: 0.1.0
description: >
  Use Veil MCP with Base MCP to register and deposit into Veil Cash on Base,
  read balances/status, and submit explicitly confirmed private withdrawals,
  transfers, or x402 payments through the Veil relay.
author: veildotcash
metadata:
  homepage: https://veil.cash
  requires:
    mcps:
      - base-mcp
      - veil
triggers:
  - veil mcp
  - veil cash
  - private deposit
  - deposit privately
  - withdraw privately
  - pay x402
  - private x402
  - base mcp veil
---

# Veil Base MCP

Use this skill when the user wants to use Veil Cash through Base MCP.

Read the plugin spec at `plugins/veil.md` before calling tools. Public wallet actions must go through Base MCP `send_calls`. Private relay and x402 payment actions require explicit user confirmation.

If the `@veil-cash/sdk` skill is also present, treat it as CLI-specific reference only. For this integration, do not use CLI signing modes, Bankr flows, or direct SDK transaction submission in place of Base MCP.

Important behavior carried over from the Veil CLI skill:

- All operations target Base mainnet.
- A dedicated Base `RPC_URL` is recommended because Merkle tree, event, queue, and balance reads can hit public RPC rate limits. It does not replace Base MCP.
- Deposit amounts are net amounts; fee handling is built into the prepare tool.
- Deposits enter a queue before becoming private balance (typically 8-12 minutes); `veil_deposit_status` reports queue position and ETA.
- Private transfers require the recipient to already be registered with Veil.
- x402 payments use private USDC, reserve a fresh deterministic payer index, and support standard Base USDC x402 (GET and POST) resources. Always set a tight `maxPayment` cap (default and hard cap 10 USDC). `veil_pay_x402` pre-flights the endpoint and withdraws nothing if it does not return 402; use `veil_x402_quote` to validate the request and price first. If a funded payer with enough USDC already exists it returns `reuse_available` so the user can reuse it via `payerIndex` (no new withdrawal) or `forceFresh: true` to withdraw anew. Each payment writes a local receipt readable via `veil_x402_receipts`, and `veil_x402_payer_balances` surfaces funds left on a payer.
- A single transaction consumes at most 16 input UTXOs; when balances fragment, use `veil_consolidate_utxos` to merge notes via a private self-transfer.
- Agents should summarize actions in plain language rather than presenting raw calldata.
- Never expose `VEIL_KEY`, proof internals, nullifiers, encrypted outputs, payer private keys, or signatures.
