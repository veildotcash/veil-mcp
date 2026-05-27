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

If another Veil skill from `@veil-cash/sdk` is available, treat it as CLI-specific reference only. This plugin is the authority for Base MCP use: do not switch to CLI signing modes, Bankr flows, or direct SDK transaction submission.

## Setup

Run Base MCP and Veil MCP side by side. For Hermes and other MCP clients that discover tools during startup, install Veil MCP globally so the client can launch the binary directly:

```bash
npm install -g @veil-cash/mcp
```

```json
{
  "mcpServers": {
    "base-mcp": { "url": "https://mcp.base.org" },
    "veil": {
      "command": "veil-mcp"
    }
  }
}
```

As a fallback, use the published npm package through `npx`:

```json
{
  "mcpServers": {
    "base-mcp": { "url": "https://mcp.base.org" },
    "veil": {
      "command": "npx",
      "args": ["-y", "@veil-cash/mcp"]
    }
  }
}
```

Use `npx -y github:veildotcash/veil-mcp` only for development or nightly testing. GitHub package resolution can slow MCP client startup because tool discovery waits for the subprocess to launch.

Veil keys are local. Base Account smart wallets do not reliably provide the plain `personal_sign` signature needed for Veil's deterministic key derivation, so v1 uses a random local Veil key. If `veil_status` shows no Veil key, call `veil_init_keypair`.

`RPC_URL` is optional and defaults to `https://mainnet.base.org`. Recommend a dedicated Base RPC endpoint because Veil balance and proof-building flows pull Merkle tree data, historical events, queue state, and wallet balances, which can hit public RPC rate limits. A dedicated RPC can also reduce metadata exposure, but it does not replace Base MCP: Veil MCP still prepares public wallet calls, and Base MCP still submits them with `send_calls`.

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
4. Veil MCP veil_status({ owner }) to confirm key and registration state
5. Veil MCP veil_prepare_register({ owner })
6. Base MCP send_calls({ chain: "base", calls })
7. Base MCP get_request_status(requestId)
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
2. For private transfers, verify the recipient is registered if that is not already known.
3. Call veil_withdraw(..., confirm: true) or veil_transfer(..., confirm: true).
4. Report only transaction hash, block number, asset, amount, recipient, and success.
```

Do not route private relay actions through Base MCP `send_calls`.

Subaccounts:

```text
1. Call veil_subaccount_status({ slot }) for slot status only.
2. Valid slots are 0 through 2.
3. If the user asks to deploy, sweep, merge, or recover subaccounts, explain that v1 of this MCP only exposes status.
```

## Error Guidance

- Missing local Veil key: call `veil_init_keypair` or ask the user to provide `VEIL_KEY` in `.env.veil`.
- Missing deposit key: call `veil_init_keypair`; do not invent or request raw private key material from the user.
- Different registered deposit key: ask before retrying `veil_prepare_register` with `force: true`, because it prepares a key rotation.
- Invalid amount: ETH minimum is `0.01`; USDC minimum is `10`.
- RPC/network failure: retry when appropriate and suggest setting `RPC_URL` to a dedicated Base RPC, especially when Merkle tree or event reads appear rate-limited.
- Relay failure: check `veil_status` relay health and do not resubmit private actions without user confirmation.

## Safety Rules

- Never ask Veil MCP to reveal `VEIL_KEY`.
- Never echo private proof internals, nullifiers, encrypted outputs, or signatures.
- Do not show raw calldata as the final user-facing answer. Summarize asset, amount, fee, status, request id, transaction hash, and nonce.
- Confirm symbol, amount, recipient, and whether the action uses Base MCP approval or the Veil relay before any write.
- If a user asks to recover, sweep, deploy, or merge subaccounts, explain that v1 only supports subaccount status.
