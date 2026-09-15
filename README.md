# Patchrail

**Ship what was agreed. Release only what passes.**

Patchrail is a release-acceptance contract for software delivery. A client and a builder
freeze a versioned acceptance rail — a fixed set of payment-bearing gates — before work
starts. The builder submits an immutable release candidate (RC). GenLayer validators
independently inspect the repository, deployment, and release evidence against each
gate's semantic criterion and must reach exact agreement before a gate is recorded
`SATISFIED`. A separate vault contract then releases the gate's fixed milestone
percentage of GEN — deterministically, exactly once, to a beneficiary fixed by the
sealed definition.

Patchrail is not a generic freelance-escrow marketplace. There is no bounty board, no
"submit a URL and get paid" flow, and no single party — client, builder, or platform
operator — who can unilaterally decide a gate passed. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for why this specific shape, and
[`docs/CONSENSUS.md`](docs/CONSENSUS.md) for exactly what GenLayer validators do and do
not get to assert.

## Network

```text
Network: GenLayer Studionet
Chain ID: 61999
RPC: https://studio.genlayer.com/api
Explorer: https://explorer-studio.genlayer.com
Currency: GEN
```

`lib/genlayer/network.ts` is the single source of truth for this configuration.
`npm run check:network` verifies it in CI before anything else runs.

## Contracts

- [`contracts/patchrail_release.py`](contracts/patchrail_release.py) — project spec,
  gates, RC revisions, the leader/validator gate consensus, and accepted release state.
  Never touches value.
- [`contracts/patchrail_vault.py`](contracts/patchrail_vault.py) — GEN escrow. Reads
  PatchrailRelease's gate findings via read-only cross-contract calls and releases the
  fixed bps share for a gate the instant, and only once, PatchrailRelease reports it
  `SATISFIED`.

Both are pinned to the stable Studionet contract family:

```python
# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

## Frontend

Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind CSS 4 + Framer
Motion + Zod + viem + `genlayer-js` pinned exactly to `1.1.8`. See
[`docs/CONTRACT_SURFACE.md`](docs/CONTRACT_SURFACE.md) for the full route list and
adapter surface.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in addresses after a real deployment
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm run check:network
npm run contracts:compile-check
npm run test:contracts   # pure-Python unit tests against a local genlayer stub
npm run test             # Vitest frontend unit tests
npm run build
```

## Deployment

```bash
PRIVATE_KEY=0x... npx tsx scripts/deploy.ts
```

This deploys `PatchrailRelease`, then `PatchrailVault` (bound to the release address),
wires `PatchrailRelease.vault_address` to the vault, and writes
`docs/DEPLOYMENT_RECORD.json` with real transaction hashes, addresses, and hashes of the
exact deployed source. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the current,
honest deployment status — this project does not claim deployment evidence it did not
actually produce.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CONSENSUS.md`](docs/CONSENSUS.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/CONTRACT_SURFACE.md`](docs/CONTRACT_SURFACE.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/REVIEWER_DEMO.md`](docs/REVIEWER_DEMO.md)
