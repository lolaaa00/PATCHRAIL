# Architecture

## Why two contracts

```text
┌────────────────────────┐   read-only view calls    ┌───────────────────────┐
│   PatchrailRelease      │ <------------------------ │   PatchrailVault      │
│                          │ ------------------------> │                       │
│ project spec             │   (gate_is_satisfied,      │ GEN escrow            │
│ gates + payment bps      │    get_project, get_gate,  │ claimable/released    │
│ RC revisions (frozen)    │    list_gate_ids)          │ balances              │
│ leader/validator         │                            │ deterministic payout  │
│ gate consensus           │                            │ = total * bps / 10000 │
└────────────────────────┘                            └───────────────────────┘
```

`PatchrailRelease` decides bounded, semantic gate findings. It never holds or moves
GEN. `PatchrailVault` is the only contract that custodies value, and it only ever
*reads* PatchrailRelease's state to decide whether a payout is authorized — it never
trusts a caller-supplied claim about what PatchrailRelease decided.

This is a real composability boundary, not a decorative second contract: PatchrailVault
is meaningless without a release-acceptance decision to gate on, and PatchrailRelease's
findings are meaningless if nothing consumes them to move real money. Splitting them
also means a bug in the (much larger, AI-touching) Release contract cannot corrupt the
Vault's own accounting invariants — the Vault re-derives everything it needs
(`payment_bps` sum, gate satisfaction) from Release's public view surface rather than
trusting a cached copy.

### Why cross-contract calls are read-only in both directions

Every call PatchrailVault makes into PatchrailRelease, and the one call
PatchrailRelease makes into PatchrailVault (`sync_funding_status` reading
`is_funded`), is a `.view()` call. This is deliberate: `.view()` cross-contract calls
are the pattern this codebase has actually exercised and can vouch for. A
write-triggering-a-write across two Intelligent Contracts touches execution-ordering
and emit-timing semantics this project has not independently verified are synchronous
within one transaction, and nothing in the value-safety-critical path should depend on
an assumption that has not been checked. Funding, claiming, and refunding are therefore
all initiated directly by an externally-owned account (client or a permissionless
caller), never by one contract writing into the other.

## Why GenLayer must be in the loop

If a single centralized operator decided gate findings instead of GenLayer consensus,
the trust model fails immediately: that operator could declare "quality passed" or
"deployment matches the RC" with no independent check, and real milestone GEN would
move on their say-so alone. GenLayer's leader/validator consensus (see
[`CONSENSUS.md`](CONSENSUS.md)) means a gate can only be recorded `SATISFIED` when
multiple independent executions of the same fetch-and-classify logic agree on every
material field. GenLayer here controls something consequential: the release of real,
staged GEN against a fixed rail — not a summary, not a decorative score.

## State machines

### Project (`PatchrailRelease`)

```text
DRAFT --lock_definition--> DRAFT (locked)
DRAFT (locked) --sync_funding_status (vault confirms)--> FUNDED
FUNDED --submit_release_candidate--> RELEASE_CANDIDATE
RELEASE_CANDIDATE --evaluate_gate (NOT_SATISFIED/INCONCLUSIVE/UNAVAILABLE)--> ACTIVE
ACTIVE --submit_release_candidate (new RC)--> RELEASE_CANDIDATE
RELEASE_CANDIDATE --evaluate_gate (all mandatory gates SATISFIED on this RC)--> ACCEPTED
{FUNDED, ACTIVE, RELEASE_CANDIDATE} --expire_project (now > deadline)--> EXPIRED
DRAFT --cancel_project--> CANCELLED
```

`ACCEPTED`, `EXPIRED`, and `CANCELLED` are terminal — no further RCs or gate
evaluations are accepted once reached.

### Gate finding (per gate, per RC)

Each `(project, gate, rc)` triple gets at most one finding record, produced by
`evaluate_gate`. Findings are not mutated after the fact by anything other than a
fresh `evaluate_gate` call against the *same current* RC — a new RC revision always
evaluates fresh, it never inherits or carries forward an old RC's findings.

### No mixing incompatible RC revisions

A gate's `dependency_gate_id` must be `SATISFIED` **for the exact same RC** currently
being evaluated, not merely satisfied at some point in the project's history. This
means: if RC1 satisfies the quality gate and RC2 is later submitted, the deploy gate
(which depends on quality) cannot be evaluated against RC2 until the quality gate is
*re-evaluated and re-satisfied against RC2 itself*. Concretely this guarantees the
"simplest safe rule" the spec calls for: final acceptance (all mandatory gates
`SATISFIED`) can only ever be reached with every one of those gates satisfied on one
single RC revision — it is structurally impossible to accept a project by combining
docs from RC1, deploy from RC5, and code from RC2. See `_all_mandatory_satisfied_for_rc`
and the dependency check at the top of `evaluate_gate` in
[`contracts/patchrail_release.py`](../contracts/patchrail_release.py).

Payment is not subject to the same restriction: once a gate's finding is `SATISFIED`
on *any* RC, its milestone is earned and claimable in the Vault — re-satisfying a
gate on a later RC does not re-trigger payment (`claim_gate` is exact-once per gate).

## Frontend / contract separation

| Layer | Responsibility |
| --- | --- |
| `lib/genlayer/` | Network identity, read/write client factories, finality polling, explorer links, GEN base-unit math |
| `lib/wallet/` | EIP-1193 wallet connection, chain-change/account-change handling, network guard |
| `lib/contract/` | Typed adapters over `readContract`/`writeContract`, the write-side tx lifecycle state machine, deployed-address resolution |
| `lib/validation/` | Zod schemas mirroring every contract-side bound, so the same rule never drifts between client and contract |
| `app/` | Routes — thin composition of the above, never a place where a gate finding or a payout amount is decided |

The Intelligent Contracts are the sole source of truth. Next.js is used only for
build/static delivery and for composing reads/writes against the chain — no server
route ever decides application state.
