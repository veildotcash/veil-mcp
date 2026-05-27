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

[Hermes Agent](https://hermes-agent.nousresearch.com) users can add Veil MCP as a stdio server in `config.yaml`:

```yaml
mcp_servers:
  veil:
    command: veil-mcp
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

MCP responses never include `VEIL_KEY`, wallet private keys, proof arguments, nullifiers, encrypted outputs, or private relay internals. `veil_withdraw` and `veil_transfer` require `confirm: true` because they submit through the Veil relay rather than Base MCP approval links. Before a private transfer, verify that the recipient is registered for Veil.
