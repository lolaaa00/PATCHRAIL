import pytest

CLIENT = "0xC000000000000000000000000000000000000C"
BUILDER = "0xB000000000000000000000000000000000000B"
OTHER = "0xD000000000000000000000000000000000000D"
REPO_URL = "https://github.com/org/repo"
DEPLOY_URL = "https://app.example.com"
REL_ADDR = "0xRE1000000000000000000000000000000000001"
VAULT_ADDR = "0xVA1000000000000000000000000000000000001"

REPO_EVIDENCE = "https://github.com/org/repo/commit/abc1234deadbeef"
DEPLOY_EVIDENCE = "https://app.example.com/build/1"
RELEASE_EVIDENCE = "https://github.com/org/repo/releases/tag/v1"


def _sat(items, finding="SATISFIED", commit_match="YES", deployment_relation="MATCHES_RC"):
    ev = ", ".join('{"source": "%s", "excerpt": "%s"}' % (s, e) for s, e in items)
    return '{"finding": "%s", "commit_match": "%s", "deployment_relation": "%s", "evidence": [%s], "reason": "ok"}' % (
        finding, commit_match, deployment_relation, ev,
    )


def _setup(release, stub, make_vault, total=1000, deadline_offset=1_000_000, gates=None):
    stub.CURRENT_SENDER["value"] = CLIENT
    pid = release.create_project("p1", BUILDER, "T", REPO_URL, DEPLOY_URL, 3, total, stub.CURRENT_TIME["value"] + deadline_offset)
    gates = gates or [("quality", "repo", 4000, True, ""), ("deploy", "deploy", 6000, True, "quality")]
    for gate_id, role, bps, mandatory, dep in gates:
        release.add_gate(pid, gate_id, gate_id.title(), "Criterion long enough to pass validation for " + gate_id, "OTHER", [role], bps, mandatory, dep, "MUST_MATCH_BOTH_PROJECT_HOSTS")
    release.lock_definition(pid)

    vault = make_vault(REL_ADDR)
    stub.ContractAt.register(REL_ADDR, release)
    stub.ContractAt.register(VAULT_ADDR, vault)
    stub.CURRENT_SENDER["value"] = release.owner
    release.set_vault_address(VAULT_ADDR)
    return pid, vault


def _fund(release, stub, vault, pid, total=1000):
    stub.CURRENT_SENDER["value"] = CLIENT
    stub.CURRENT_VALUE["value"] = total
    vault.fund_project(pid)
    release.sync_funding_status(pid)


def _submit_and_satisfy(release, stub, pid, gate_id, url, content, excerpt):
    stub.CURRENT_SENDER["value"] = BUILDER
    if release.get_project(pid).current_rc_revision == 0:
        release.submit_release_candidate(pid, "abc1234deadbeef", REPO_EVIDENCE, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, "")
    stub.WEB_FIXTURES[url] = content
    resp = _sat([(list(release.get_gate(pid, gate_id).evidence_requirements)[0], excerpt)])
    stub.PROMPT_QUEUE.extend([resp, resp])
    return release.evaluate_gate(pid, gate_id)


# ---------------------------------------------------------------------------
# Funding
# ---------------------------------------------------------------------------

def test_fund_requires_exact_amount(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    stub.CURRENT_SENDER["value"] = CLIENT
    stub.CURRENT_VALUE["value"] = 999
    with pytest.raises(Exception):
        vault.fund_project(pid)


def test_fund_requires_client_sender(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    stub.CURRENT_SENDER["value"] = OTHER
    stub.CURRENT_VALUE["value"] = 1000
    with pytest.raises(Exception):
        vault.fund_project(pid)


def test_fund_requires_locked_definition(release, stub, make_vault):
    stub.CURRENT_SENDER["value"] = CLIENT
    pid = release.create_project("p2", BUILDER, "T", REPO_URL, DEPLOY_URL, 3, 1000, stub.CURRENT_TIME["value"] + 1000)
    release.add_gate(pid, "quality", "Quality", "Criterion long enough to pass validation", "OTHER", ["repo"], 10000, True, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")
    # not locked
    vault = make_vault(REL_ADDR)
    stub.ContractAt.register(REL_ADDR, release)
    stub.CURRENT_SENDER["value"] = CLIENT
    stub.CURRENT_VALUE["value"] = 1000
    with pytest.raises(Exception):
        vault.fund_project(pid)


def test_cannot_fund_twice(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    stub.CURRENT_SENDER["value"] = CLIENT
    stub.CURRENT_VALUE["value"] = 1000
    with pytest.raises(Exception):
        vault.fund_project(pid)


def test_funding_syncs_release_status(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    assert release.get_project(pid).status == "DRAFT"
    _fund(release, stub, vault, pid, total=1000)
    assert release.get_project(pid).status == "FUNDED"


# ---------------------------------------------------------------------------
# Claiming
# ---------------------------------------------------------------------------

def test_no_early_payment_before_satisfied(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    with pytest.raises(Exception):
        vault.claim_gate(pid, "quality")


def test_claim_pays_deterministic_bps_share(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    amount = vault.claim_gate(pid, "quality")
    assert amount == 400
    assert stub.TRANSFERS == [(BUILDER, 400)]


def test_claim_gate_exactly_once(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    vault.claim_gate(pid, "quality")
    with pytest.raises(Exception):
        vault.claim_gate(pid, "quality")


def test_claim_beneficiary_is_always_the_builder(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    stub.CURRENT_SENDER["value"] = OTHER  # arbitrary caller triggers settlement
    vault.claim_gate(pid, "quality")
    assert stub.TRANSFERS == [(BUILDER, 400)]


def test_claim_rolls_back_on_transfer_failure_and_allows_retry(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    stub.TRANSFER_FAILURES.add(BUILDER)
    with pytest.raises(Exception):
        vault.claim_gate(pid, "quality")
    assert vault.is_claimed(pid, "quality") is False
    stub.TRANSFER_FAILURES.discard(BUILDER)
    amount = vault.claim_gate(pid, "quality")
    assert amount == 400
    assert stub.TRANSFERS == [(BUILDER, 400)]


def test_conservation_full_lifecycle(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    vault.claim_gate(pid, "quality")
    _submit_and_satisfy(release, stub, pid, "deploy", DEPLOY_EVIDENCE, "Build 1 is live running commit abc1234deadbeef.", "is live running commit abc1234deadbeef")
    vault.claim_gate(pid, "deploy")
    assert release.get_project(pid).status == "ACCEPTED"
    total_paid = sum(v for _, v in stub.TRANSFERS)
    assert total_paid == 1000
    assert vault.get_released_total(pid) == 1000


# ---------------------------------------------------------------------------
# Expiry / refund
# ---------------------------------------------------------------------------

def test_refund_requires_funded(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    with pytest.raises(Exception):
        vault.refund_unearned(pid)


def test_refund_blocked_before_deadline(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    with pytest.raises(Exception):
        vault.refund_unearned(pid)


def test_refund_after_expiry_returns_unearned_remainder_only(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    vault.claim_gate(pid, "quality")
    stub.CURRENT_TIME["value"] += 2000
    refunded = vault.refund_unearned(pid)
    assert refunded == 600
    assert sorted(stub.TRANSFERS) == sorted([(BUILDER, 400), (CLIENT, 600)])


def test_builder_keeps_earned_release_after_expiry(release, stub, make_vault):
    """A gate satisfied before expiry is carved out of the refund pool and
    stays claimable by the builder even after the deadline passes."""
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    stub.CURRENT_TIME["value"] += 2000  # expire without claiming quality yet
    refundable = vault.get_refundable_estimate(pid)
    assert refundable == 600  # the satisfied-but-unclaimed 400 is reserved, not refundable
    amount = vault.claim_gate(pid, "quality")
    assert amount == 400
    refunded = vault.refund_unearned(pid)
    assert refunded == 600
    assert sorted(stub.TRANSFERS) == sorted([(BUILDER, 400), (CLIENT, 600)])


def test_cannot_double_refund(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    stub.CURRENT_TIME["value"] += 2000
    vault.refund_unearned(pid)
    with pytest.raises(Exception):
        vault.refund_unearned(pid)


def test_no_refund_after_full_acceptance(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    vault.claim_gate(pid, "quality")
    _submit_and_satisfy(release, stub, pid, "deploy", DEPLOY_EVIDENCE, "Build 1 is live running commit abc1234deadbeef.", "is live running commit abc1234deadbeef")
    vault.claim_gate(pid, "deploy")
    stub.CURRENT_TIME["value"] += 2000
    with pytest.raises(Exception):
        vault.refund_unearned(pid)


# ---------------------------------------------------------------------------
# Cross-contract binding robustness
# ---------------------------------------------------------------------------

def test_vault_rejects_construction_without_release_address(make_vault):
    with pytest.raises(Exception):
        make_vault("")


def test_wrong_gate_id_raises(release, stub, make_vault):
    pid, vault = _setup(release, stub, make_vault, total=1000)
    _fund(release, stub, vault, pid, total=1000)
    with pytest.raises(Exception):
        vault.claim_gate(pid, "no-such-gate")


def test_final_gate_absorbs_rounding_dust(release, stub, make_vault):
    """Three gates at 3334/3333/3333 bps over a total of 1000 floor to
    333/333/333 = 999, one unit short. The deterministically last gate
    (highest order_index — 'final' here) must absorb that dust so the full
    1000 is exactly claimable, not permanently stuck in the vault."""
    gates = [("quality", "repo", 3334, True, ""), ("deploy", "deploy", 3333, True, ""), ("final", "release", 3333, True, "")]
    pid, vault = _setup(release, stub, make_vault, total=1000, gates=gates)
    _fund(release, stub, vault, pid, total=1000)

    assert vault.get_gate_payout_amount(pid, "quality") == 333
    assert vault.get_gate_payout_amount(pid, "deploy") == 333
    # final gate gets the exact remainder, not its own floor (also 333)
    assert vault.get_gate_payout_amount(pid, "final") == 1000 - 333 - 333

    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    _submit_and_satisfy(release, stub, pid, "deploy", DEPLOY_EVIDENCE, "Build 1 is live running commit abc1234deadbeef.", "is live running commit abc1234deadbeef")
    _submit_and_satisfy(release, stub, pid, "final", RELEASE_EVIDENCE, "Release notes for abc1234deadbeef.", "Release notes for abc1234deadbeef")

    a1 = vault.claim_gate(pid, "quality")
    a2 = vault.claim_gate(pid, "deploy")
    a3 = vault.claim_gate(pid, "final")
    assert a1 + a2 + a3 == 1000
    assert vault.get_released_total(pid) == 1000
    assert sum(v for _, v in stub.TRANSFERS) == 1000


def test_refund_then_evaluate_and_claim_are_both_blocked(release, stub, make_vault):
    """The exact path the review flagged: after a deadline refund pays out
    the unearned remainder, a gate that was never satisfied beforehand must
    be unreachable through BOTH evaluate_gate (PatchrailRelease) and
    claim_gate (PatchrailVault) — not just one of the two."""
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    vault.claim_gate(pid, "quality")

    stub.CURRENT_TIME["value"] += 2000
    refunded = vault.refund_unearned(pid)
    assert refunded == 600

    with pytest.raises(Exception):
        release.evaluate_gate(pid, "deploy")
    with pytest.raises(Exception):
        vault.claim_gate(pid, "deploy")


def test_claim_conservation_guard_independent_of_release_block(release, stub, make_vault):
    """Defense in depth: even if a gate's satisfied_rc were somehow set
    after a refund — bypassing PatchrailRelease's own refusal to evaluate —
    PatchrailVault's own conservation check must still refuse to pay more
    than deposited - released - refunded. The two defenses do not rely on
    each other to hold."""
    pid, vault = _setup(release, stub, make_vault, total=1000, deadline_offset=1000)
    _fund(release, stub, vault, pid, total=1000)
    stub.CURRENT_TIME["value"] += 2000
    refunded = vault.refund_unearned(pid)
    assert refunded == 1000

    # Force satisfied_rc directly to simulate the state PatchrailRelease's
    # own block now prevents from ever being reached through evaluate_gate.
    release.satisfied_rc[release._gate_key(pid, "quality")] = "forced-rc"
    with pytest.raises(Exception):
        vault.claim_gate(pid, "quality")


def test_multiple_projects_isolated_in_shared_vault(release, stub, make_vault):
    """Two independent projects funded into the SAME vault instance must
    never contaminate each other's accounting."""
    pid1, vault = _setup(release, stub, make_vault, total=1000)

    stub.CURRENT_SENDER["value"] = CLIENT
    pid2 = release.create_project("p2", BUILDER, "T2", REPO_URL, DEPLOY_URL, 3, 2000, stub.CURRENT_TIME["value"] + 1_000_000)
    for gate_id, role, bps, mandatory, dep in [("quality", "repo", 4000, True, ""), ("deploy", "deploy", 6000, True, "quality")]:
        release.add_gate(pid2, gate_id, gate_id.title(), "Criterion long enough to pass validation for " + gate_id, "OTHER", [role], bps, mandatory, dep, "MUST_MATCH_BOTH_PROJECT_HOSTS")
    release.lock_definition(pid2)

    _fund(release, stub, vault, pid1, total=1000)
    _fund(release, stub, vault, pid2, total=2000)
    assert vault.get_deposit(pid1) == 1000
    assert vault.get_deposit(pid2) == 2000

    amount1 = _submit_and_satisfy(release, stub, pid1, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    assert amount1 == "SATISFIED"
    claimed1 = vault.claim_gate(pid1, "quality")
    assert claimed1 == 400

    # project 2 must be completely unaffected by project 1's claim
    assert vault.get_released_total(pid2) == 0
    assert vault.is_claimed(pid2, "quality") is False
    assert vault.get_deposit(pid1) == 1000
    assert vault.get_deposit(pid2) == 2000

    stub.reset_fixtures()
    amount2 = _submit_and_satisfy(release, stub, pid2, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    assert amount2 == "SATISFIED"
    claimed2 = vault.claim_gate(pid2, "quality")
    assert claimed2 == 800  # 2000 * 4000 // 10000

    assert vault.get_released_total(pid1) == 400
    assert vault.get_released_total(pid2) == 800
    assert sorted(stub.TRANSFERS) == sorted([(BUILDER, 800)])


def test_very_small_deposit_conservation(release, stub, make_vault):
    """Even a deposit smaller than the gate count must be exactly conserved:
    every non-final gate's floored share can round down to 0, and the final
    gate must absorb the entire remainder so nothing is lost."""
    gates = [("quality", "repo", 3334, True, ""), ("deploy", "deploy", 3333, True, ""), ("final", "release", 3333, True, "")]
    pid, vault = _setup(release, stub, make_vault, total=2, gates=gates)
    _fund(release, stub, vault, pid, total=2)

    assert vault.get_gate_payout_amount(pid, "quality") == 0
    assert vault.get_gate_payout_amount(pid, "deploy") == 0
    assert vault.get_gate_payout_amount(pid, "final") == 2

    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    _submit_and_satisfy(release, stub, pid, "deploy", DEPLOY_EVIDENCE, "Build 1 is live running commit abc1234deadbeef.", "is live running commit abc1234deadbeef")
    _submit_and_satisfy(release, stub, pid, "final", RELEASE_EVIDENCE, "Release notes for abc1234deadbeef.", "Release notes for abc1234deadbeef")

    a1 = vault.claim_gate(pid, "quality")
    a2 = vault.claim_gate(pid, "deploy")
    a3 = vault.claim_gate(pid, "final")
    assert (a1, a2, a3) == (0, 0, 2)
    assert vault.get_released_total(pid) == 2


def test_single_unit_deposit_conservation(release, stub, make_vault):
    """The extreme case: a deposit of 1 base unit across 3 gates. Every
    non-final floor is 0 and the final gate claims the entire unit."""
    gates = [("quality", "repo", 3334, True, ""), ("deploy", "deploy", 3333, True, ""), ("final", "release", 3333, True, "")]
    pid, vault = _setup(release, stub, make_vault, total=1, gates=gates)
    _fund(release, stub, vault, pid, total=1)

    _submit_and_satisfy(release, stub, pid, "quality", REPO_EVIDENCE, "Commit abc1234deadbeef fixes lint errors.", "fixes lint errors")
    _submit_and_satisfy(release, stub, pid, "deploy", DEPLOY_EVIDENCE, "Build 1 is live running commit abc1234deadbeef.", "is live running commit abc1234deadbeef")
    _submit_and_satisfy(release, stub, pid, "final", RELEASE_EVIDENCE, "Release notes for abc1234deadbeef.", "Release notes for abc1234deadbeef")

    a1 = vault.claim_gate(pid, "quality")
    a2 = vault.claim_gate(pid, "deploy")
    a3 = vault.claim_gate(pid, "final")
    assert (a1, a2, a3) == (0, 0, 1)
    assert vault.get_released_total(pid) == 1


def test_vault_refuses_funds_if_bps_do_not_sum_to_10000(release, stub, make_vault):
    """Defense in depth: even though PatchrailRelease enforces bps==10000 at
    lock time, the vault independently re-verifies before ever accepting a
    deposit, and must never credit funds against a broken definition."""
    stub.CURRENT_SENDER["value"] = CLIENT
    pid = release.create_project("p3", BUILDER, "T", REPO_URL, DEPLOY_URL, 3, 1000, stub.CURRENT_TIME["value"] + 1000)
    release.add_gate(pid, "quality", "Quality", "Criterion long enough to pass validation", "OTHER", ["repo"], 10000, True, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")
    release.lock_definition(pid)

    vault = make_vault(REL_ADDR)
    stub.ContractAt.register(REL_ADDR, release)

    # Tamper with the locked project directly to simulate a corrupted/foreign
    # Release instance reporting an inconsistent gate table.
    release.gates[release._gate_key(pid, "quality")].payment_bps = 9000

    stub.CURRENT_SENDER["value"] = CLIENT
    stub.CURRENT_VALUE["value"] = 1000
    with pytest.raises(Exception):
        vault.fund_project(pid)
