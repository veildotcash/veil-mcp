# @veil-cash/mcp

Local MCP server for Veil Cash on Base.

This server wraps `@veil-cash/sdk` and exposes Base MCP-compatible tools for agents. Public wallet actions return unsigned calldata for Base MCP `send_calls`; private actions use the local Veil key and submit through the Veil relay only when explicitly confirmed.

## MCP Config

Run Veil MCP beside Base MCP. For Hermes and other MCP clients that start tools during session startup, install the CLI globally so the client can launch `veil-mcp` directly:

```bash
npm install -g @veil-cash/mcp
```

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    },
    "veil": {
      "command": "veil-mcp"
    }
  }
}
```

As a fallback, MCP clients can run the published npm package with `npx`:

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    },
    "veil": {
      "command": "npx",
      "args": ["-y", "@veil-cash/mcp"]
    }
  }
}
```

The GitHub install form, `npx -y github:veildotcash/veil-mcp`, is intended for development or nightly testing only. It can add startup latency because npm must resolve the GitHub package before the MCP client can discover tools.

### Hermes Agent config.yaml

[Hermes Agent](https://hermes-agent.nousresearch.com) users can add Veil MCP as a stdio server in `config.yaml`. Hermes defaults `connect_timeout` to 60 seconds; veil-mcp completes the stdio handshake in ~1.7s on cold start, so 10 seconds is a tighter but comfortable limit:

```yaml
mcp_servers:
  veil:
    command: veil-mcp
    connect_timeout: 10
```

## Local Development

```bash
npm install
npm run build
```

For a local checkout:

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    },
    "veil": {
      "command": "node",
      "args": ["/absolute/path/to/veil-mcp/dist/index.cjs"]
    }
  }
}
```

## Environment

The server loads `.env.veil` first, then `.env`, matching the Veil CLI convention.

| Variable | Purpose |
| --- | --- |
| `VEIL_KEY` | Local Veil private key for private balances, withdrawals, transfers, and subaccounts |
| `DEPOSIT_KEY` | Public Veil deposit key used for register/deposit calldata |
| `RPC_URL` | Optional Base RPC URL, defaults to `https://mainnet.base.org` |
| `RELAY_URL` | Optional Veil relay URL override |
| `X402_RELAY_URL` | Optional x402 relay base URL, defaults to `RELAY_URL + /x402` or hosted relay `/x402` |
| `X402_PAYER_INDEX` | Persisted deterministic payer index; managed by `veil_pay_x402` |

Configure `RPC_URL` with a dedicated Base RPC endpoint for reliable Veil reads. Private balance and proof-building flows pull Merkle tree data, historical events, queue state, and wallet balances, which can exceed public RPC rate limits. A dedicated RPC can also reduce metadata exposure, but it does not replace Base MCP: public wallet actions should still be prepared by Veil MCP and submitted through Base MCP `send_calls`.

Use `veil_init_keypair` to generate a random local Veil keypair. It writes `.env.veil` and returns only the public deposit key.

## Agent Skill

This package includes the MCP-specific agent skill in `skills/veil-base-mcp`. If an agent also discovers the `@veil-cash/sdk` skill, treat that SDK skill as CLI-specific. For Base MCP integrations, follow `skills/veil-base-mcp`: Veil MCP prepares public wallet calldata, Base MCP submits it, and private withdraw/transfer actions go through the Veil relay only after explicit confirmation.

## Tools

| Tool | Purpose |
| --- | --- |
| `veil_init_keypair` | Generate and save a random local Veil keypair |
| `veil_status` | Check key, relay, wallet, and registration status |
| `veil_get_balances` | Read wallet, queue, and private balances |
| `veil_deposit_status` | Check one queued deposit by pool and nonce |
| `veil_wait_for_deposit` | Poll a queued deposit until accepted/rejected/refunded or timeout |
| `veil_prepare_register` | Return Base `send_calls` calldata for registration |
| `veil_prepare_deposit` | Return Base `send_calls` calldata for ETH/USDC deposits |
| `veil_withdraw` | Submit a private withdrawal through the Veil relay |
| `veil_transfer` | Submit a private transfer through the Veil relay |
| `veil_consolidate_utxos` | Merge fragmented private UTXOs into fewer notes via a self-transfer |
| `veil_pay_x402` | Pay a Coinbase-compatible x402 resource from private USDC |
| `veil_x402_quote` | Probe an x402 resource for price/requirement without funding or paying |
| `veil_x402_receipts` | List local x402 spend history and total USDC spent |
| `veil_x402_payer_balances` | Inspect USDC left on deterministic x402 payer EOAs |
| `veil_subaccount_status` | Read subaccount status |

`veil_prepare_register` and `veil_prepare_deposit` return:

```json
{
  "chain": "base",
  "calls": [
    {
      "to": "0x...",
      "value": "0x0",
      "data": "0x..."
    }
  ]
}
```

Pass `chain` and `calls` directly to Base MCP `send_calls`.

If `veil_prepare_register` returns `action: "alreadyRegistered"` with an empty `calls` array, do not call `send_calls`; continue to deposit or balance checks.

Deposits treat `amount` as the net amount intended to land in Veil. The 0.3% protocol fee is calculated and included in the prepared calldata. After Base MCP confirms the transaction, the deposit enters the Veil queue before it reaches private balance. Typical queue processing is around 8-12 minutes.

Use `veil_deposit_status({ owner, pool, nonce })` when you know the queue nonce, or `veil_get_balances({ owner, pool })` to discover pending deposits. `veil_deposit_status` reports `queuePosition`, `queueLength`, and `typicalProcessingMinutes` for pending deposits. `veil_wait_for_deposit` is available for MCP clients that can tolerate a long-running poll.

## Private Balance Fragmentation

A single Veil transaction (withdraw, transfer, or x402 payment) can consume at
most 16 input UTXOs. Heavy x402 usage creates many small change UTXOs, so a
balance can become fragmented beyond what a single transaction can spend.

`veil_get_balances` reports a `fragmentation` summary per pool, including
`unspentCount`, `largestUtxo`, `smallestUtxo`, and `needsConsolidation`. When
`needsConsolidation` is true (more than 16 unspent UTXOs), call
`veil_consolidate_utxos({ asset, confirm: true })` to merge notes via a private
self-transfer. Consolidation runs one round of up to 16 inputs; repeat while the
response reports `needsAnotherRound: true`.

## x402 Payments

`veil_pay_x402({ url, method, body, headers, maxPayment, confirm })` pays a
standard x402 v2 Base USDC `exact` resource from the local private USDC balance.
It reserves the current `X402_PAYER_INDEX`, withdraws the exact payment amount to
the deterministic fresh payer EOA, signs the x402 payment from that EOA, and
returns the paid response body plus a structured `receipt`.

Both GET and POST resources are supported. Set `method: "POST"` and pass `body`
(a JSON object, sent as `application/json`, or a raw string) for POST endpoints;
`headers` adds custom request headers. `body` is only valid with POST.

### Avoiding wasted withdrawals

`veil_pay_x402` pre-flights the endpoint before funding. If the unpaid probe does
not return `402` (for example a `422` for a malformed body, or a non-payment
response), it returns `action: "endpoint_error"` with the status and body and
withdraws nothing. Use `veil_x402_quote({ url, method, body, headers, maxPayment })`
to validate the request and see the price up front; it never funds or pays.

Note: a merchant that only validates the request body *after* payment will still
return `402` to the probe. In that case the payer is funded but delivery fails,
leaving the USDC on the payer EOA. To recover it, retry without a new withdrawal:

- Before a fresh withdrawal, `veil_pay_x402` scans already-funded payer EOAs. If
  one holds enough USDC for the payment it returns `action: "reuse_available"`
  with candidate payer indexes instead of withdrawing again.
- Re-call `veil_pay_x402({ ..., payerIndex })` to pay from that funded payer with
  no new withdrawal, or pass `forceFresh: true` to withdraw to a brand-new payer.

Reusing a payer links both attempts to the same public EOA; it is offered as a
consented choice via `reuse_available`, not done silently.

Set a tight `maxPayment` cap (a decimal USDC string such as `"0.10"`) for every
call. The payment is rejected before any funds move if the resource demands more
than the cap. `maxPayment` defaults to and is hard-capped at `10` USDC.

Each payment is logged locally to `.veil-x402-receipts.json`. Use
`veil_x402_receipts({ limit })` to reconstruct spend history and total USDC
spent. Use `veil_x402_payer_balances({ startIndex, count, nonZeroOnly })` to
surface USDC left on a payer EOA after a failed payment; those funds remain
recoverable from `VEIL_KEY + payerIndex`.

Set `X402_RELAY_URL` to the x402 route base, for example
`https://veil-relay.example/x402`. If only `RELAY_URL` is set, the MCP appends
`/x402`.

## Safety

MCP responses never include `VEIL_KEY`, wallet private keys, proof arguments, nullifiers, encrypted outputs, x402 signatures, or private relay internals. `veil_withdraw`, `veil_transfer`, and `veil_pay_x402` require `confirm: true` because they submit through the Veil relay rather than Base MCP approval links. Before a private transfer, verify that the recipient is registered for Veil.
