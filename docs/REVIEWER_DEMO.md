# Reviewer demo

This walks through the full lifecycle a reviewer should be able to complete in the
live app, once `NEXT_PUBLIC_RELEASE_ADDRESS` / `NEXT_PUBLIC_VAULT_ADDRESS` point at a
real Studionet deployment (see [`DEPLOYMENT.md`](DEPLOYMENT.md) for current status).
Every step below is exercised in the automated test suites cited alongside it, so a
reviewer without a funded wallet can verify the same logic by running
`npm run test:contracts` and reading the referenced test.

## Setup

You need two Studionet-connected wallet accounts: one acting as **client**, one as
**builder**. Get each some GEN from the Studio faucet/UI.

## 1. Create the rail (client)

1. Connect the client wallet. Go to `/new`.
2. Fill in a project ID, the builder's address, title, repo/deploy URLs, a deadline,
   and a total GEN value.
3. Add gates until "% of 100%" reads exactly 100%. A realistic rail:
   `Quality (25%, mandatory) → Docs (15%, mandatory, depends on Quality) → Deploy
   (30%, mandatory, depends on Docs) → Final Acceptance (30%, mandatory, depends on
   Deploy)`.
4. Submit. The form sequentially creates the project, adds each gate, and locks the
   definition — you'll see a step log and the tx lifecycle tracker for each write.
   *(`tests/contract/test_release.py::test_lock_definition_requires_bps_sum_10000`,
   `::test_definition_immutable_after_lock`)*

## 2. Fund it (client)

1. From `/p/[id]`, click **Fund this project**.
2. Confirm the exact GEN amount shown — the vault will reject anything else.
3. After finalization, the page syncs PatchrailRelease's status to `FUNDED`.
   *(`tests/contract/test_vault.py::test_fund_requires_exact_amount`,
   `::test_funding_syncs_release_status`)*

## 3. Submit a release candidate (builder)

1. Switch to the builder wallet. Go to `/p/[id]/rc`.
2. Enter a real commit SHA and the three (or four, with a test artifact) evidence
   URLs. Submit.
3. The RC is now frozen — see it at `/rc/[id]`.
   *(`::test_rc_evidence_urls_cannot_all_be_identical`,
   `::test_old_rc_remains_readable_after_new_revision`)*

## 4. Evaluate a gate (anyone)

1. From `/p/[id]/gates`, click **Evaluate gate** on the Quality gate.
2. This triggers GenLayer's leader/validator consensus (see
   [`CONSENSUS.md`](CONSENSUS.md)) against the live repo evidence URL. Watch the
   finding, `commit_match`, `deployment_relation`, and cited evidence appear.
3. Try evaluating **Deploy** before **Quality** is satisfied — it is rejected; the
   gate rail's dependency ordering is enforced on-chain, not just in the UI.
   *(`::test_gate_dependency_blocks_out_of_order_evaluation`,
   `::test_satisfied_finding_unlocks_dependent_gate`)*

## 5. Claim a payout (anyone — beneficiary is always the builder)

1. Once Quality is `SATISFIED`, click **Claim** on that gate. The exact
   `total × 2500 ÷ 10000` GEN amount moves to the builder's fixed address.
2. Try claiming it again — rejected, exact-once.
   *(`::test_claim_pays_deterministic_bps_share`, `::test_claim_gate_exactly_once`)*
3. See the release recorded at `/receipt/[projectId]:quality`.

## 6. Reach final acceptance

1. Submit further RCs and evaluate the remaining gates until every mandatory gate is
   `SATISFIED` **on the same RC revision**. The project status moves to `ACCEPTED` and
   the gate rail's green line runs the full length.
   *(`::test_final_acceptance_requires_same_rc_for_all_mandatory_gates`)*

## Negative-path fixtures worth trying deliberately

- Submit an RC, let its Quality gate evaluation come back `NOT_SATISFIED` (point the
  repo evidence URL at a page that plainly doesn't support the criterion), then submit
  a corrected RC revision and re-evaluate — the old RC's evidence and finding remain
  readable at `/rc/[old-id]` unchanged.
- Let a project's deadline pass without full acceptance, call **Mark expired**, then
  **Refund unearned** from `/p/[id]/gates` — confirm the client receives exactly the
  unclaimed, unsatisfied remainder, and any already-`SATISFIED`-but-unclaimed gate
  remains independently claimable by the builder afterward.
  *(`::test_builder_keeps_earned_release_after_expiry`)*
- Connect a wallet on the wrong chain and confirm every write path refuses before
  ever prompting a signature (`WRONG_NETWORK`, `lib/contract/txLifecycle.ts`).
