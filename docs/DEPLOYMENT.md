# Deployment

## Target network

```text
Network: GenLayer Studionet
Chain ID: 61999
RPC: https://studio.genlayer.com/api
Explorer: https://explorer-studio.genlayer.com
Currency: GEN
```

## How to deploy

```bash
PRIVATE_KEY=0x... npx tsx scripts/deploy.ts
```

This deploys `contracts/patchrail_release.py`, then `contracts/patchrail_vault.py`
(constructed with the release contract's address), waits for `FINALIZED` status on
both, wires `PatchrailRelease.vault_address` to the deployed vault via
`set_vault_address` (waiting for that write to finalize too), and writes
`docs/DEPLOYMENT_RECORD.json` (git-ignored) with the exact SHA-256 and byte length of
each deployed contract source, the git commit, the deploy transaction hashes, the
resulting addresses, and both contracts' finalized execution status.

## Real deployment status — honest, as of this build

**No live deployment to Studionet has been performed for this project.** This build
was produced without access to a private key funded with GEN on Studionet or on any
other network. `scripts/deploy.ts` refuses to run at all without a `PRIVATE_KEY`
environment variable — see its explicit fail-fast check — specifically so that this
document is never written from a fabricated or assumed outcome.

What **has** been verified, without a live network, and is real evidence of
correctness independent of deployment:

- `python3 -m py_compile contracts/patchrail_release.py contracts/patchrail_vault.py`
  — both contracts parse and compile cleanly under CPython 3 (`npm run
  contracts:compile-check`).
- 46 pure-Python unit tests (`npm run test:contracts`) exercise every state
  transition, the leader/validator consensus logic (including forged-excerpt
  rejection, validator disagreement, deterministic commit-hash override, and
  source-unavailable short-circuiting), and the full GEN accounting lifecycle
  (funding, exact-once claiming, rollback-on-transfer-failure, expiry refund,
  and conservation) against a hand-written local stand-in for the `genlayer`
  runtime (`tests/contract/genlayer_stub.py`) — **not** a live GenVM simulator.
- 26 Vitest unit tests (`npm run test`) cover the network guard, the write
  lifecycle state machine, GEN base-unit conversion, and every Zod validation
  boundary that mirrors a contract-side check.
- `npm run build` produces a clean Next.js 16 production build of all 9 routes.
- `npm run check:network` confirms the resolved chain configuration is exactly
  `61999` @ `https://studio.genlayer.com/api`.

None of this substitutes for a real, funded, on-chain deployment, and this document
will not claim otherwise. A real deployment requires:

1. A Studionet account funded with GEN (sufficient for two contract deployments plus
   one `set_vault_address` write, plus whatever GEN a reviewer wants to fund a demo
   project with).
2. Running `PRIVATE_KEY=0x... npx tsx scripts/deploy.ts` from a clean checkout of this
   exact source.
3. Setting `NEXT_PUBLIC_RELEASE_ADDRESS` / `NEXT_PUBLIC_VAULT_ADDRESS` in `.env.local`
   (or the hosting provider's environment) from the script's output, and redeploying
   the frontend.

If a live deployment is attempted after this document was written and it succeeds,
`docs/DEPLOYMENT_RECORD.json` (generated, git-ignored) will contain the real addresses
and transaction hashes; if it is attempted and hits a network-level obstacle (as the
sibling Antecedent project did — see that project's `DEPLOYMENT.md` for the format),
this document should be updated with the same tx-hash-table and diagnosis rigor rather
than silently leaving the claim above in place.

## After a successful deployment

```bash
NEXT_PUBLIC_RELEASE_ADDRESS=0x...
NEXT_PUBLIC_VAULT_ADDRESS=0x...
```

Until both are set, every page in this app correctly reports `NOT_DEPLOYED` via
`components/NotDeployedNotice.tsx` and `lib/contract/addresses.ts#requireAddress`
rather than silently pretending a contract exists.

## Time primitive — needs live verification

`_now()` in both contracts calls `gl.vm.get_current_transaction_time()`, which the
stable py-genlayer runtime documents as GenVM-deterministic transaction time (not
browser time, not Next.js server time, not a caller-supplied value). This has been
exercised extensively in the local stub (which lets tests set `CURRENT_TIME`
directly) but, like everything else in this document, has not been exercised against
a live Studionet transaction. Anyone deploying for real should treat a deadline-driven
write (`expire_project`, `refund_unearned`) as the first thing worth a manual
end-to-end check against real block/transaction timestamps before relying on it for a
funded project with real GEN at stake.
