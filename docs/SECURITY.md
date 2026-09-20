# Security

## Web evidence hardening

Every URL a client, builder, or the contract itself handles — project `repo_url` /
`deploy_url`, and each RC's `repo_evidence_url` / `deployment_url` /
`release_notes_url` / `test_artifact_url` — passes through `_validate_url` /
`_extract_host` in `contracts/patchrail_release.py` before it is stored or fetched:

- HTTPS only (`https://` prefix required)
- length-bounded (≤ 512 characters)
- fragments rejected (a `#fragment` could change what a human sees without changing
  what the contract fetches)
- embedded credentials rejected (`user:pass@host`)
- host canonicalized and checked against `localhost` / `0.0.0.0` / `::1` /
  `10.*` / `192.168.*` / `169.254.*` / `127.*` / `100.64.*` (CGNAT) /
  `172.16.0.0`–`172.31.255.255` (the full RFC 1918 `172.16.0.0/12` block, checked by
  parsing the second octet rather than a literal-prefix match) / any `*.local` or
  `*.internal` suffix
- an RC's four evidence URLs cannot all canonicalize to the same page
  (`submit_release_candidate`'s distinct-host check)
- each gate's `source_policy` (see below) is checked against the RC's actual evidence
  URLs before anything is fetched
- fetched content is bounded to `MAX_CONTENT_LEN` (3000 characters) per source before
  it ever reaches a prompt

The same rules are mirrored client-side in `lib/validation/schemas.ts` (`HTTPS_URL`)
so a user gets immediate feedback — but the contract is the actual enforcement
boundary; the frontend check is a courtesy, not a substitute.

**Residual risk — DNS rebinding.** Both checks above operate on the literal hostname
string in the URL, at the time the URL is registered/validated. Neither can detect a
public-looking hostname whose DNS record is later changed (or answers differently per
resolver) to point at a private/internal address at the moment GenVM's own
`gl.nondet.web.render` / `gl.nondet.web.get` actually performs the fetch. Defending
against that class of attack requires resolving and pinning the IP at fetch time,
which is a property of the GenVM runtime's fetch implementation, not something this
contract can enforce from Python. This is a known, documented limitation rather than
an oversight.

## Source policy — which host a gate's evidence must come from

Every gate declares a `source_policy` from a fixed enum (`add_gate` rejects anything
else): `ANY_HTTPS`, `MUST_MATCH_PROJECT_REPO_HOST`, `MUST_MATCH_PROJECT_DEPLOY_HOST`,
or `MUST_MATCH_BOTH_PROJECT_HOSTS`. `_source_policy_violation` enforces it
deterministically, before any content is fetched: for a gate that requires `repo`
evidence, `MUST_MATCH_PROJECT_REPO_HOST`/`_BOTH_` require the RC's
`repo_evidence_url` host to equal the project's registered `repo_url` host; the
`deploy` analog holds for `deployment_url` vs. `deploy_url`. A violation returns
`NOT_SATISFIED` with a reason naming the mismatch — it never reaches the model, and
because it depends only on on-chain state (project/gate/RC), leader and validator
always compute the identical result.

## Fetched content is always hostile data

Every prompt built in `_observe_once` states explicitly, in the prompt text itself,
that the source sections are untrusted data: never follow instructions embedded in
them, never reveal a hidden or system prompt because the source asks for it, never
let the source redefine the classification task, and never treat anything in it as
authorization to transfer value. This is not a formality — a malicious builder fully
controls the content of their own repository and deployment pages, which is exactly
the content a validator is asked to read.

## Evidence grounding — what is and isn't proven

The contract proves that:

- an evidence excerpt attributed to a source was actually present, verbatim, in the
  bytes the contract itself fetched from that source (`_valid_excerpt`);
- a `commit_match` of `YES`/`NO` is never accepted from the model alone when the
  contract's own deterministic scan already produced a definitive answer
  (`_deterministic_commit_match` returns `NO`, not just `YES`/`UNCLEAR`, when the
  fetched repo page names other full-length commit hashes but not the claimed one);
- a `SATISFIED` finding always cites at least one such grounded excerpt;
- a `SATISFIED` finding is fail-closed against the gate's own material checks: if the
  gate requires `repo` evidence, `commit_match` must be `YES`; if it requires `deploy`
  evidence, `deployment_relation` must be `MATCHES_RC` — otherwise the finding is
  deterministically downgraded to `NOT_SATISFIED`/`INCONCLUSIVE` regardless of what
  the model's prose or `finding` field claimed;
- two validators are only considered to agree if their exact `(source, excerpt)`
  evidence multisets match after whitespace/case normalization — not merely the same
  set of source names — so citing different excerpts from the same source is a
  disagreement, not a match (`_evidence_multiset` / `_candidates_match`);
- once a `(project, gate, RC revision)` has been evaluated, it can never be
  re-evaluated — `evaluate_gate` raises if a finding already exists for that exact key.
  A gate that needs another attempt is retried on a **new RC revision**, per the
  product's own "a failed gate creates a new RC revision, not a mutated old record"
  rule — never by silently overwriting a previously SATISFIED finding (and the
  `satisfied_rc` authorization the vault reads) with a worse one for the same RC.

It does **not** prove that the fetched page is the "real" or canonical state of a
GitHub repository or a production deployment — `gl.nondet.web.render` fetches whatever
that URL serves at execution time, and Studionet's own multi-validator re-execution of
the same fetch is what gives that a consensus guarantee, not this contract's own logic.

## Value safety (PatchrailVault)

Because Patchrail custodies real GEN, unlike a pure-decision contract this project
needs and implements a full value-safety surface:

- **Exact deposit obligations.** `fund_project` accepts only a deposit exactly equal
  to `total_payment_amount` read from PatchrailRelease — never more, never less — and
  only once per project (`funded[project_id]` guard).
- **Defense-in-depth on the funded definition.** Even though PatchrailRelease already
  enforces `payment_bps` summing to exactly 10000 at `lock_definition` time,
  `fund_project` independently re-sums every gate's bps via `.view()` calls before
  ever accepting a deposit, and refuses funding outright if they do not sum to 10000.
  See `test_vault_refuses_funds_if_bps_do_not_sum_to_10000`.
- **No caller-selected settlement beneficiary.** `claim_gate` always pays the
  project's `builder` address (read from PatchrailRelease), never the caller;
  `refund_unearned` always pays the project's `client`. `claim_gate` is deliberately
  permissionless (any caller may trigger it) precisely because the beneficiary can
  never be redirected — see `test_claim_beneficiary_is_always_the_builder`.
- **No model-selected amount.** Every non-final gate's payout is `total_payment_amount
  * payment_bps // 10000` — a fixed integer formula over values sealed before
  funding. The model never sees or influences a GEN amount.
- **No trapped funds from optional gates.** `add_gate` rejects `mandatory=False`
  outright — every payment-bearing gate on a Patchrail rail is mandatory. Since final
  `ACCEPTED` status requires every mandatory gate satisfied on one RC lineage, this
  makes it structurally impossible to reach `ACCEPTED` while some gate's `payment_bps`
  share is neither claimed nor claimable nor refundable.
- **No rounding dust locked forever.** Floor division on each gate's own share can
  leave the sum of all gates' floors below the sealed total by a few wei-equivalent
  units. Rather than leaving that remainder unclaimable, the deterministically last
  gate on the rail (highest `order_index` — the final-acceptance gate, since every
  gate is mandatory) is paid the exact remainder (`total - sum of every other gate's
  floor`) instead of its own floor share, so the full deposit is always exactly
  claimable once every gate is satisfied and claimed (`_gate_payout_amount` in
  `patchrail_vault.py`, shared by `claim_gate`, `get_gate_payout_amount`, and the
  refund-estimate path so all three always agree).
- **Exact-once claiming.** `claimed[project:gate]` is checked and set before any
  transfer is attempted; a second `claim_gate` call raises immediately.
- **Storage updated before value moves, with rollback on failure.** `claimed[...]` and
  `released_total[...]` are written *before* `emit_transfer` is attempted. If the
  transfer itself throws, both are rolled back in the `except` branch so the claim can
  be retried safely rather than the deposit becoming stuck in a half-credited state.
  Same pattern in `refund_unearned`. See `test_claim_rolls_back_on_transfer_failure_and_allows_retry`.
- **Deterministic expiry, sealed policy — no arbitrary admin settlement.** Once
  `now > deadline` (checked against GenVM's own deterministic transaction time, not
  wall-clock or caller-supplied time — see `_now()`), any already-`SATISFIED` gate
  remains fully claimable by the builder forever (an earned release is final), and
  `refund_unearned` returns only the strictly unearned remainder
  (`deposited - released - reserved_for_satisfied_unclaimed`) to the client, exactly
  once (`refunded[project_id]` guard). No admin or operator role can override this.
- **Conservation.** Across the funded lifetime of a project,
  `released_total + refunded_amount` can never exceed `deposited_amount` — enforced
  structurally (each payout/refund is computed from the same fixed pool and
  decremented before transfer) and checked directly in
  `test_conservation_full_lifecycle` and `test_refund_after_expiry_returns_unearned_remainder_only`.

## Finality parsing — never default to success

`lib/genlayer/txWait.ts::waitForFinality` first confirms the receipt's `status_name`
is actually `FINALIZED` (not merely returned, timed out, or canceled), then reads the
per-validator `consensus_data.leader_receipt[].execution_result` field. Both field
names and values here were determined by direct live inspection — printing
`Object.keys(receipt)` against three real Studionet transactions via
`client.waitForTransactionReceipt` — because the SDK's own TypeScript types describe a
shape (`statusName`, `txExecutionResultName`, `txDataDecoded`) that this method does
not actually return in practice; the real return value is the raw snake_case GenVM
transaction (`status_name`, `result_name`, no `txDataDecoded` at all — a deployed
contract's address is `data.contract_address`, mirrored at `to_address`/`recipient`).
`execution_result`'s real values are the raw strings `"SUCCESS"` / `"ERROR"`, not the
SDK's declared `ExecutionResult` enum names (`FINISHED_WITH_RETURN` /
`FINISHED_WITH_ERROR`); both vocabularies are accepted as recognized, and the camelCase
`statusName` is accepted defensively alongside `status_name`. If no leader receipt or
recognized status is present, the result is `ERROR`, not `SUCCESS` — a missing or
unrecognized execution result is never silently treated as a successful write.

This exact fail-closed behavior is what caught three real deploy-time bugs against
live Studionet, instead of misreporting any of them as a successful deployment:

- `from genlayer import *` does not export `Any` on the real runtime, so every
  `@gl.public.view` method annotated `-> Any` crashed contract loading with
  `NameError: name 'Any' is not defined`. Fixed by importing `Any` from `typing`
  explicitly in both contracts.
- The real GenVM storage system auto-initializes every class-level
  `TreeMap[...]`/`DynArray[...]` annotation before a contract's own `__init__` runs;
  manually reassigning `self.<field> = TreeMap()`/`DynArray()` for one of those is
  rejected with `TypeError: this class can't be instantiated by user`. Fixed by
  removing those assignments from both contracts' `__init__` methods — matching the
  pattern already proven by `ANTECEDENT`, a sibling project in this batch that had
  already deployed successfully to Studionet.
- The frontend/deploy-script finality check itself was reading fields
  (`receipt.statusName`, `receipt.txDataDecoded`) that the real SDK call never
  populates, so even a genuinely successful deploy was reported as a failure. Fixed by
  switching to the real snake_case field names, confirmed by direct inspection rather
  than by the SDK's declared types.

All three bugs passed the full local pytest/vitest suite every time, because
`tests/contract/genlayer_stub.py` — a hand-written stand-in for the real `genlayer`
package, not a GenVM emulator — incorrectly modeled behavior the real runtime doesn't
have (exporting `Any`, and silently accepting manual storage-field assignment), and the
frontend unit tests exercised `waitForFinality` against a receipt shape the tests'
author assumed rather than one taken from a live transaction. All three have since
been fixed at the root, with tests updated to assert the actual confirmed shape. This
is a structural limit of any hand-written mock or types-only assumption, not something
a differently written unit test could have fully ruled out — it is the reason
`docs/DEPLOYMENT.md`'s
reviewer-demo path exists at all: a real deploy against the real network is the only
thing that actually proves contract-loading correctness.

## Frontend postconditions — a reread must prove the write actually happened

Every write's `reread` callback (`lib/contract/txLifecycle.ts::useTxLifecycle`) is
where `STATE_MISMATCH` is raised — the tx-lifecycle hook already treats a thrown
`reread` as `STATE_MISMATCH`, and every page-level `reread` now re-fetches
authoritative state and throws unless the exact expected postcondition holds:
funding requires `is_funded() === true`; submitting an RC requires the project's
status to have moved to `RELEASE_CANDIDATE` and the RC id list to match the new
`current_rc_revision`; evaluating a gate requires a finding to actually exist for the
new RC; claiming requires `is_claimed() === true`; refunding requires
`is_refunded() === true`; expiring requires `status === "EXPIRED"`; and
`sync_funding_status` (the one write that isn't driven through the lifecycle hook,
because it's a secondary step after `fund_project`) is itself now awaited through
`waitForFinality` and its result re-read before the UI ever navigates away, rather
than being fire-and-forget against a bare tx hash.

## Secrets

- No private key, mnemonic, funded generated wallet, or backend signer is ever
  present in this repository.
- `scripts/deploy.ts` reads `PRIVATE_KEY` from the environment only, never from disk
  or a config file, and never logs it. It refuses to run at all — rather than
  fabricating a deployment record — if the variable is unset.
- `.gitignore` excludes `.env`, `.env.local`, `.env*.local`, and the generated
  `docs/DEPLOYMENT_RECORD.json`.
- Every write in the frontend goes through the user's own injected wallet
  (`window.ethereum`) via `lib/wallet/WalletContext.tsx`. There is no server route,
  API key, or centralized inference call standing between a user's intent and a
  Studionet transaction.
