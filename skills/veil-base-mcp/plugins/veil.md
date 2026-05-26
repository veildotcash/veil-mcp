# Veil Cash Plugin

> [!IMPORTANT]
> ## STOP - COMPLETE BASE MCP ONBOARDING BEFORE USING THIS PLUGIN
>
> Before preparing any Veil transaction, complete Base MCP onboarding:
> 1. Call Base MCP `get_wallets`.
> 2. Present the connected wallet status and required disclaimer.
> 3. Use the connected Base Account address as `owner` for Veil MCP calls.

Veil Cash is a privacy pool for ETH and USDC on Base mainnet. Veil MCP prepares unsigned calldata for public wallet actions, then Base MCP executes that calldata through `send_calls`.

Supported chain: Base mainnet (`8453`, Base MCP chain name `base`).

## Setup

Run Base MCP and Veil MCP side by side:

```json
{
  "mcpServers": {
    "base-mcp": { "url": "https://mcp.base.org" },
    "veil": {
      "command": "npx",
      "args": ["-y", "github:veildotcash/veil-mcp"]
    }
  }
}
```

When installed from GitHub, npm runs the package `prepare` script to build the local `veil-mcp` binary before the MCP client starts it.

Veil keys are local. Base Account smart wallets do not reliably provide the plain `personal_sign` signature needed for Veil's deterministic key derivation, so v1 uses a random local Veil key. If `veil_status` shows no Veil key, call `veil_init_keypair`.

## Read Tools

```text
veil_status({ owner? })
veil_get_balances({ owner, pool?: "eth" | "usdc" | "all" })
veil_deposit_status({ owner, pool: "eth" | "usdc", nonce })
veil_wait_for_deposit({ owner, pool: "eth" | "usdc", nonce, timeoutSeconds?, intervalSeconds? })
veil_subaccount_status({ slot })
```

Use `owner` from Base MCP `get_wallets`.

## Prepare Tools

```text
veil_prepare_register({ owner, force?: boolean })
veil_prepare_deposit({ owner, asset: "ETH" | "USDC", amount: string })
```

Both return:

```json
{
  "chain": "base",
  "calls": [
    { "to": "0x...", "value": "0x0", "data": "0x..." }
  ]
}
```

For USDC deposits, the calls are ordered approval first, then deposit. Submit the full batch in one `send_calls` request.

If `veil_prepare_register` returns `action: "alreadyRegistered"` and `calls: []`, do not call `send_calls`; continue to deposit or balance checks. If it errors because a different deposit key is already registered, ask the user before retrying with `force: true`.

Deposit amounts are net amounts. The prepare tool checks whether the owner has a free daily deposit slot; if not, it includes the protocol fee in the prepared calldata. Minimums are `0.01 ETH` and `10 USDC`.

## send_calls Mapping

After a prepare tool returns, call Base MCP:

```json
{
  "chain": "base",
  "calls": [
    { "to": "<call.to>", "value": "<call.value>", "data": "<call.data>" }
  ]
}
```

Then poll Base MCP `get_request_status` until the request is completed, failed, or rejected.

## Orchestration

Registration:

```text
1. Base MCP get_wallets -> owner
2. Veil MCP veil_status({ owner })
3. If missing local Veil key, call veil_init_keypair({})
4. Veil MCP veil_prepare_register({ owner })
5. Base MCP send_calls({ chain: "base", calls })
6. Base MCP get_request_status(requestId)
```

Deposit:

```text
1. Base MCP get_wallets -> owner
2. Veil MCP veil_status({ owner })
3. Ensure local Veil key exists and owner is registered
4. Veil MCP veil_prepare_deposit({ owner, asset, amount })
5. Base MCP send_calls({ chain: "base", calls })
6. Base MCP get_request_status(requestId)
7. Veil MCP veil_get_balances({ owner, pool }) to find pending nonce
8. Veil MCP veil_deposit_status({ owner, pool, nonce }) until status is not "pending"
```

After Base MCP confirms the transaction, the funds are not immediately private. They enter the Veil queue first. Typical queue processing is around `10-15 minutes`. Report this lifecycle clearly: submitted on Base, pending in queue, then accepted into private balance.

Private withdraw or transfer:

```text
1. Ask the user to explicitly confirm the relay-backed private action.
2. Call veil_withdraw(..., confirm: true) or veil_transfer(..., confirm: true).
3. Report only transaction hash, block number, asset, amount, recipient, and success.
```

Do not route private relay actions through Base MCP `send_calls`.

## Safety Rules

- Never ask Veil MCP to reveal `VEIL_KEY`.
- Never echo private proof internals, nullifiers, encrypted outputs, or signatures.
- Do not show raw calldata as the final user-facing answer. Summarize asset, amount, fee, status, request id, transaction hash, and nonce.
- Confirm symbol, amount, recipient, and whether the action uses Base MCP approval or the Veil relay before any write.
- If a user asks to recover, sweep, deploy, or merge subaccounts, explain that v1 only supports subaccount status.
