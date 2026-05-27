---
name: veil-base-mcp
version: 0.1.0
description: >
  Use Veil MCP with Base MCP to register and deposit into Veil Cash on Base,
  read balances/status, and submit explicitly confirmed private withdrawals or
  transfers through the Veil relay.
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
  - base mcp veil
---

# Veil Base MCP

Use this skill when the user wants to use Veil Cash through Base MCP.

Read the plugin spec at `plugins/veil.md` before calling tools. Public wallet actions must go through Base MCP `send_calls`. Private relay actions require explicit user confirmation.

If the `@veil-cash/sdk` skill is also present, treat it as CLI-specific reference only. For this integration, do not use CLI signing modes, Bankr flows, or direct SDK transaction submission in place of Base MCP.

Important behavior carried over from the Veil CLI skill:

- All operations target Base mainnet.
- A dedicated Base `RPC_URL` is recommended because Merkle tree, event, queue, and balance reads can hit public RPC rate limits. It does not replace Base MCP.
- Deposit amounts are net amounts; fee handling is built into the prepare tool.
- Deposits enter a queue before becoming private balance.
- Private transfers require the recipient to already be registered with Veil.
- Agents should summarize actions in plain language rather than presenting raw calldata.
- Never expose `VEIL_KEY`, proof internals, nullifiers, encrypted outputs, or signatures.
