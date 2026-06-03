---
name: veil-base-mcp
version: 0.2.1
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
  - shielded payments
  - privacy pool
---

# Veil Base MCP

Use this skill when the user wants to use Veil Cash through Base MCP.

Read the plugin at `plugins/veil.md` before calling tools. It follows the [Base MCP plugin spec](https://github.com/base/skills/blob/master/skills/base-mcp/references/plugin-spec.md) (`integration: external-mcp`, stdio-only v1 — no hosted HTTP URL).

## Routing summary

| Flow | Veil MCP | Base MCP submission |
| --- | --- | --- |
| Register / deposit | `veil_prepare_*` | `send_calls` |
| Read (status, balances, quotes) | read tools | `none` |
| Withdraw / transfer / x402 / consolidate | relay tools (`confirm: true`) | `none` |

Complete Base MCP onboarding first (`get_wallets` → use `baseAccount.address` as `owner`). Install the local Veil MCP (stdio) alongside Base MCP if no `veil_*` tools are exposed — see `plugins/veil.md` § Installation. Veil does not offer a hosted HTTP MCP; keys stay on the user's machine.

If the `@veil-cash/sdk` skill is also present, treat it as CLI-specific reference only. Do not use CLI signing modes, Bankr flows, or direct SDK transaction submission in place of this plugin.

## Quick reference

- **Chain:** Base mainnet only (`base`, chain id `8453`).
- **Keys:** Local `VEIL_KEY` via `veil_init_keypair` or server env; Base Account cannot derive Veil keys in v1.
- **Deposits:** Net amounts; 0.3% fee in calldata; queue ~8–12 min before private balance.
- **Private writes:** Require explicit user confirmation and `confirm: true`.
- **x402:** Quote first; tight `maxPayment` (hard cap 10 USDC); handle `reuse_available`.
- **UTXOs:** Max 16 inputs per tx; use `veil_consolidate_utxos` when fragmented.
- **Safety:** Never expose `VEIL_KEY`, proof internals, or signatures. Summarize actions in plain language.

Full orchestration, submission mapping, example prompts, and risks: `plugins/veil.md`.
