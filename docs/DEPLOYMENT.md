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
(constructed with the release contract's address), waits for `FINALIZED` status with a
fail-closed real execution-result check on both (`lib/genlayer/txWait.ts`), wires
`PatchrailRelease.vault_address` to the deployed vault via `set_vault_address` (waiting
for that write to finalize too), and writes `docs/DEPLOYMENT_RECORD.json` with the
exact SHA-256 and byte length of each deployed contract source, the git commit, the
deploy transaction hashes, the resulting addresses, and both contracts' finalized
execution status.

## Real deployment status

**Both contracts are live on Studionet.** Full record in
[`DEPLOYMENT_RECORD.json`](DEPLOYMENT_RECORD.json); summary below.

| Contract | Address | Deploy tx | Explorer |
| --- | --- | --- | --- |
| `PatchrailRelease` | `0x5648992E4f1Dd37cb54662d4d11459D58F036df1` | `0x9f0c133d720c437196d951cb4178c76b4980445ccbb3c6f21de2d4c30150ebd8` | [tx](https://explorer-studio.genlayer.com/tx/0x9f0c133d720c437196d951cb4178c76b4980445ccbb3c6f21de2d4c30150ebd8) · [address](https://explorer-studio.genlayer.com/address/0x5648992E4f1Dd37cb54662d4d11459D58F036df1) |
| `PatchrailVault` | `0xc6A813315e5Cdc9f90132d4f9233374041621A43` | `0xed49d4510dd4cdfae3bf3387ad00ba34ed234ec4df417b42f5c8a551203e1c9e` | [tx](https://explorer-studio.genlayer.com/tx/0xed49d4510dd4cdfae3bf3387ad00ba34ed234ec4df417b42f5c8a551203e1c9e) · [address](https://explorer-studio.genlayer.com/address/0xc6A813315e5Cdc9f90132d4f9233374041621A43) |

Wiring (`PatchrailRelease.set_vault_address(vault)`): tx
[`0xf70e201626ca1f4b52e21993df93933b12a35428e474403c08e4baaed851452e`](https://explorer-studio.genlayer.com/tx/0xf70e201626ca1f4b52e21993df93933b12a35428e474403c08e4baaed851452e)
— `FINALIZED` / `SUCCESS`.

Public signer: `0x778D1663f9D5b338aBaD5C62899830AD3520a32F` (a disposable Studionet
test key funded with test GEN only — not a production signer, holds no meaningful
value, and is not reused for anything else).

Independent readback taken immediately after deployment, before any frontend
redeploy, directly against the live contracts:

```text
Release.list_project_ids()                 -> []
Release.get_vault_address()                -> 0xc6A813315e5Cdc9f90132d4f9233374041621A43
   (matches the deployed PatchrailVault address)
Vault.is_funded("nonexistent")              -> false
```

`NEXT_PUBLIC_RELEASE_ADDRESS` / `NEXT_PUBLIC_VAULT_ADDRESS` are set to the addresses
above both in `.env.local` (git-ignored, local dev) and as Production environment
variables on the Vercel project serving this app, which has been redeployed against
them.

### What it took to get here — three real bugs, each found only by a live deploy

Three consecutive live deploy attempts failed before this succeeded, and each was a
genuine bug the local test suite could not have caught on its own (all now fixed and
covered by tests against the real confirmed behavior — see `docs/SECURITY.md`
"Finality parsing" section for the full account):

1. `from genlayer import *` does not export `Any` on the real GenVM runtime, so every
   `@gl.public.view` method annotated `-> Any` crashed contract loading with
   `NameError: name 'Any' is not defined`.
2. The real GenVM storage system auto-initializes every class-level
   `TreeMap[...]`/`DynArray[...]` annotation before a contract's own `__init__` runs;
   manually reassigning `self.<field> = TreeMap()`/`DynArray()` is rejected with
   `TypeError: this class can't be instantiated by user`.
3. `client.waitForTransactionReceipt`'s real return value is the raw snake_case GenVM
   transaction shape (`status_name`, `result_name`, no `txDataDecoded`), not the
   camelCase shape the SDK's own TypeScript types declare — so the deploy script's own
   finality check was reading a field that was never populated, and reported a
   genuinely successful deploy as a failure twice before this was found by directly
   inspecting a real receipt's `Object.keys(...)`.

This is why the "no live deployment" caveat existed in earlier revisions of this
document, and why it no longer does: a real deploy against the real network was the
only thing that actually surfaced any of the three.

## Regenerating this deployment

Anyone who wants to redeploy from a clean checkout:

1. Fund a Studionet account with GEN (enough for two contract deployments plus one
   `set_vault_address` write, plus whatever GEN a reviewer wants to fund a demo
   project with).
2. `PRIVATE_KEY=0x... npx tsx scripts/deploy.ts` — never pass the key on the command
   line where it could be logged or committed; export it into the shell instead.
3. Set `NEXT_PUBLIC_RELEASE_ADDRESS` / `NEXT_PUBLIC_VAULT_ADDRESS` from the script's
   printed output in `.env.local` and in the hosting provider's environment, then
   redeploy the frontend.

## After a deployment

```bash
NEXT_PUBLIC_RELEASE_ADDRESS=0x5648992E4f1Dd37cb54662d4d11459D58F036df1
NEXT_PUBLIC_VAULT_ADDRESS=0xc6A813315e5Cdc9f90132d4f9233374041621A43
```

Until both are set, every page in this app correctly reports `NOT_DEPLOYED` via
`components/NotDeployedNotice.tsx` and `lib/contract/addresses.ts#requireAddress`
rather than silently pretending a contract exists.

## Time primitive — needs live verification before a funded, deadline-driven write

`_now()` in both contracts calls `gl.vm.get_current_transaction_time()`, which the
stable py-genlayer runtime documents as GenVM-deterministic transaction time (not
browser time, not Next.js server time, not a caller-supplied value). This has been
exercised extensively in the local stub (which lets tests set `CURRENT_TIME`
directly), but a deadline-driven write (`expire_project`, `refund_unearned`) with real
GEN at stake should still get one manual end-to-end check against real block/
transaction timestamps on this deployment before being relied upon for a funded
project — the deploy above only exercised contract construction and wiring, not the
deadline paths.
