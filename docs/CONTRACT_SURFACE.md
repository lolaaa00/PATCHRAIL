# Contract surface

## `PatchrailRelease`

### Writes

| Method | Caller | Notes |
| --- | --- | --- |
| `create_project(project_id, builder, title, repo_url, deploy_url, max_rc_revisions, total_payment_amount, deadline)` | anyone (becomes client) | status → `DRAFT` |
| `add_gate(project_id, gate_id, label, criterion, gate_type, evidence_requirements, payment_bps, mandatory, dependency_gate_id, source_policy)` | project client | only while `DRAFT` and unlocked; `mandatory` must be `True` (every gate is mandatory — see below) and `source_policy` must be one of `SOURCE_POLICIES` |
| `lock_definition(project_id)` | project client | requires `payment_bps` sum to exactly 10000 and ≥1 mandatory gate; computes and stores `definition_hash` over every material field; freezes gates |
| `cancel_project(project_id)` | project client | only while `DRAFT` |
| `sync_funding_status(project_id)` | anyone (permissionless) | reads `PatchrailVault.is_funded`; `DRAFT` → `FUNDED` |
| `expire_project(project_id)` | anyone (permissionless) | requires `now > deadline`; → `EXPIRED` |
| `submit_release_candidate(project_id, commit_sha, repo_evidence_url, deployment_url, release_notes_url, test_artifact_url)` | project builder | frozen on submit; increments `current_rc_revision` |
| `evaluate_gate(project_id, gate_id)` | anyone (permissionless) | runs leader/validator consensus against the current RC; may set project → `ACCEPTED`; **raises if this exact `(project, gate, RC revision)` was already evaluated** — retry via a new RC, never a re-evaluation of the same one; **raises if `PatchrailVault.is_refunded(project_id)` is true** — once the unearned remainder has been paid out, no further gate on that project can ever be evaluated |
| `set_vault_address(vault_address)` | contract owner (deployer) | callable once, immutable after |

### Views

`get_project`, `list_project_ids`, `get_gate`, `list_gate_ids`, `get_rc`,
`list_rc_ids`, `get_finding`, `list_finding_ids`, `gate_is_satisfied`,
`get_satisfied_rc_id`, `get_vault_address`.

### Gate finding shape

```json
{
  "gate_id": "deploy",
  "finding": "SATISFIED|NOT_SATISFIED|INCONCLUSIVE|UNAVAILABLE",
  "commit_match": "YES|NO|UNCLEAR",
  "deployment_relation": "MATCHES_RC|STALE|UNRELATED|UNCLEAR",
  "evidence": [{ "source": "repo|deploy|release|tests", "excerpt": "verbatim" }],
  "reason": "bounded"
}
```

### Every gate is mandatory

`add_gate` rejects `mandatory=False`. Payment percentages (`payment_bps`) are only
ever assigned across gates that are guaranteed to be evaluated on the path to
`ACCEPTED`; an optional gate would let its `payment_bps` share become permanently
unclaimable and unrefundable once the project reaches `ACCEPTED`, since acceptance
only requires mandatory gates and refund is unavailable once `ACCEPTED`. Making every
gate mandatory closes that gap by construction rather than by policy.

### Source policy

Each gate's `source_policy` is one of `ANY_HTTPS`, `MUST_MATCH_PROJECT_REPO_HOST`,
`MUST_MATCH_PROJECT_DEPLOY_HOST`, `MUST_MATCH_BOTH_PROJECT_HOSTS`. Enforced
deterministically in `_source_policy_violation`, before any content is fetched:
`repo`/`release`/`tests` evidence must share the project's registered repository's
*identity* (`_repo_identity` — origin **and** first two path segments, e.g.
`github.com/org/repo`), not merely its host; `deploy` evidence must share the
project's registered deployment's exact *origin* (`_extract_origin` — host **and**
port). A violation returns `NOT_SATISFIED` immediately — see `docs/SECURITY.md`.

### Definition hash

```text
definition_hash = sha256("patchrail-def-v1",
                          project_id, client, builder, title, repo_url, deploy_url,
                          max_rc_revisions, total_payment_amount, deadline,
                          for each gate: gate_id|label|criterion|gate_type|
                                         evidence_requirements|payment_bps|mandatory|
                                         dependency_gate_id|source_policy)
```

Computed once at `lock_definition` and never recomputed — it is the sealed fingerprint
of the *complete* acceptance rail a client and builder agreed to before any GEN moved,
not just its payout split.

## `PatchrailVault`

Constructed with `release_address` (immutable).

### Writes

| Method | Caller | Notes |
| --- | --- | --- |
| `fund_project(project_id)` *(payable)* | project's client only | value must exactly equal `total_payment_amount`; requires the definition locked and `DRAFT` on Release; re-verifies `payment_bps` sum to 10000 |
| `claim_gate(project_id, gate_id)` | anyone (permissionless) | pays `total * gate.payment_bps // 10000` (or, for the deterministically last gate on the rail, `total - sum of every other gate's own individually-floored share` — see `_gate_payout_amount`) to the fixed builder address; exact-once; guard is `released + refunded + this_claim <= deposited`, not just `released + this_claim <= deposited`, so a claim can never exceed what's left after a refund |
| `refund_unearned(project_id)` | anyone (permissionless) | pays the unearned remainder to the fixed client address; exact-once; requires `now > deadline` (or Release status `EXPIRED`) and project not `ACCEPTED`; after this, `PatchrailRelease.evaluate_gate` independently refuses to evaluate any further gate on this project (reads `is_refunded` below) |

`PatchrailVault` calls `PatchrailRelease` only via `.view()` (`get_project`, `get_gate`,
`list_gate_ids`, `gate_is_satisfied`, `get_satisfied_rc_id` — `IPatchrailRelease`), and
`PatchrailRelease` calls `PatchrailVault` only via `.view()` in the other direction
(`is_funded` for `sync_funding_status`, `is_refunded` for `evaluate_gate`'s refund
block — `IPatchrailVault`). Cross-contract interaction is read-only in both
directions.

### Views

`is_funded`, `get_deposit`, `get_released_total`, `is_claimed`, `get_claimed_amount`,
`is_refunded`, `get_refunded_amount`, `get_refundable_estimate`,
`get_gate_payout_amount`.

## Frontend adapters

| File | Wraps |
| --- | --- |
| `lib/contract/release.ts` | Every `PatchrailRelease` read/write above |
| `lib/contract/vault.ts` | Every `PatchrailVault` read/write above |
| `lib/contract/useContracts.ts` | `useReleaseRead/Write`, `useVaultRead/Write`, `useDeploymentStatus` — resolves addresses from `NEXT_PUBLIC_RELEASE_ADDRESS` / `NEXT_PUBLIC_VAULT_ADDRESS`, binds writes to the connected wallet |
| `lib/contract/txLifecycle.ts` | The 7-stage write lifecycle (`AWAITING_SIGNATURE` → ... → `STATE_REREAD`) every write in the UI goes through |

## Routes

```text
/                         release-rail landing + hero
/new                      create project + define gates + lock
/p/[id]                   project rail (status, gate rail visualization, actions)
/p/[id]/fund              fund contract (client deposits exact total into the vault)
/p/[id]/rc                submit release candidate (builder)
/p/[id]/gates             acceptance gates — evaluate / claim / expire / refund
/rc/[id]                  RC dossier — frozen evidence + all findings against that RC
/receipt/[id]             payment/release receipt (id = "<projectId>:<gateId>")
/me                       projects where the connected wallet is client or builder
```

No freelancer marketplace route, no bounty board, no generic AI-dashboard page exists
anywhere in this app.
