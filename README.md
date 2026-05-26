# @veil-cash/mcp

Local MCP server for Veil Cash on Base.

This server wraps `@veil-cash/sdk` and exposes Base MCP-compatible tools for agents. Public wallet actions return unsigned calldata for Base MCP `send_calls`; private actions use the local Veil key and submit through the Veil relay only when explicitly confirmed.

## MCP Config

Run Veil MCP beside Base MCP. MCP clients can install and run this repo directly from GitHub with `npx`:

```json
{
  "mcpServers": {
    "base-mcp": {
      "url": "https://mcp.base.org"
    },
    "veil": {
      "command": "npx",
      "args": ["-y", "github:veildotcash/veil-mcp"]
    }
  }
}
```

When installed from GitHub, npm runs the package `prepare` script to build `dist/index.cjs` before the MCP client starts the server. The same package can be published to npm later without changing the MCP server code.

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

Use `veil_init_keypair` to generate a random local Veil keypair. It writes `.env.veil` and returns only the public deposit key.

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

Deposits treat `amount` as the net amount intended to land in Veil. Each address may receive fee-free deposits; otherwise the protocol fee is calculated and included in the prepared calldata. After Base MCP confirms the transaction, the deposit enters the Veil queue before it reaches private balance. Typical queue processing is around 10-15 minutes.

Use `veil_deposit_status({ owner, pool, nonce })` when you know the queue nonce, or `veil_get_balances({ owner, pool })` to discover pending deposits. `veil_wait_for_deposit` is available for MCP clients that can tolerate a long-running poll.

## Safety

MCP responses never include `VEIL_KEY`, wallet private keys, proof arguments, nullifiers, encrypted outputs, or private relay internals. `veil_withdraw` and `veil_transfer` require `confirm: true` because they submit through the Veil relay rather than Base MCP approval links.
