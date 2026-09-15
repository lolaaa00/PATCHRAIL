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
  `10.*` / `192.168.*` / `169.254.*` / `127.*`
- an RC's four evidence URLs cannot all canonicalize to the same page
  (`submit_release_candidate`'s distinct-host check)
- fetched content is bounded to `MAX_CONTENT_LEN` (3000 characters) per source before
  it ever reaches a prompt

The same rules are mirrored client-side in `lib/validation/schemas.ts` (`HTTPS_URL`)
so a user gets immediate feedback — but the contract is the actual enforcement
boundary; the frontend check is a courtesy, not a substitute.

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
  contract's own deterministic scan already produced a definitive answer;
- a `SATISFIED` finding always cites at least one such grounded excerpt.

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
- **No model-selected amount.** Every payout is `total_payment_amount * payment_bps
  // 10000` — a fixed integer formula over values sealed before funding. The model
  never sees or influences a GEN amount.
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
