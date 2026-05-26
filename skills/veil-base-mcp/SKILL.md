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

Important behavior carried over from the Veil CLI skill:

- All operations target Base mainnet.
- Deposit amounts are net amounts; fee handling is built into the prepare tool.
- Deposits enter a queue before becoming private balance.
- Agents should summarize actions in plain language rather than presenting raw calldata.
- Never expose `VEIL_KEY`, proof internals, nullifiers, encrypted outputs, or signatures.
