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
| `PatchrailRelease` | `0x5EA4b20367251221061900eA919d40276FDB49F4` | `0xf57d737e32f795f81ca08c2359ba5e8a65112d10d75c009a30d981616eda6c5e` | [tx](https://explorer-studio.genlayer.com/tx/0xf57d737e32f795f81ca08c2359ba5e8a65112d10d75c009a30d981616eda6c5e) · [address](https://explorer-studio.genlayer.com/address/0x5EA4b20367251221061900eA919d40276FDB49F4) |
| `PatchrailVault` | `0x0581b6bca963F196Ce63e2C4E2A95441583fa73D` | `0xd7fbe2b316b30eabe741cc24f38b85d2dd8074a5ac274aa2a12fbc049a3bf28e` | [tx](https://explorer-studio.genlayer.com/tx/0xd7fbe2b316b30eabe741cc24f38b85d2dd8074a5ac274aa2a12fbc049a3bf28e) · [address](https://explorer-studio.genlayer.com/address/0x0581b6bca963F196Ce63e2C4E2A95441583fa73D) |

Wiring (`PatchrailRelease.set_vault_address(vault)`): tx
[`0x599313db4e78dae78c33d842c4729d91ebcefcf16d753d734ae14965b20e74ff`](https://explorer-studio.genlayer.com/tx/0x599313db4e78dae78c33d842c4729d91ebcefcf16d753d734ae14965b20e74ff)
— `FINALIZED` / `SUCCESS`.

This is the **current deployment**, built from commit
`649791e3b0197ec18bbda63813c17072dddb431d` after the mandatory evidence-binding
and Vault-constructor ABI fixes. Both deployment receipts and the wiring receipt are
recorded as `FINALIZED` / `SUCCESS` in `DEPLOYMENT_RECORD.json`. The prior pairs at
`0xD9BF37fD5a6695565c952660D9d9366A487CFeaC` / `0x0Be56dBC6ec329c9f7aA31956A6e592fE015Eb6F`
and `0x5648992E4f1Dd37cb54662d4d11459D58F036df1` /
`0xc6A813315e5Cdc9f90132d4f9233374041621A43` are superseded and must not be used.

`NEXT_PUBLIC_RELEASE_ADDRESS` / `NEXT_PUBLIC_VAULT_ADDRESS` are set to the addresses
above both in `.env.local` (git-ignored, local dev) and as Production environment
variables on the Vercel project serving this app, then redeploy the frontend.

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
NEXT_PUBLIC_RELEASE_ADDRESS=0x5EA4b20367251221061900eA919d40276FDB49F4
NEXT_PUBLIC_VAULT_ADDRESS=0x0581b6bca963F196Ce63e2C4E2A95441583fa73D
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
