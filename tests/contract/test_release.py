import pytest

CLIENT = "0xC000000000000000000000000000000000000C"
BUILDER = "0xB000000000000000000000000000000000000B"
OTHER = "0xD000000000000000000000000000000000000D"
REPO_URL = "https://github.com/org/repo"
DEPLOY_URL = "https://app.example.com"
VAULT_ADDR = "0xVAU10000000000000000000000000000000001"

REPO_EVIDENCE = "https://github.com/org/repo/commit/abc1234deadbeef"
DEPLOY_EVIDENCE = "https://app.example.com/build/1"
RELEASE_EVIDENCE = "https://github.com/org/repo/releases/tag/v1"


def _as_client(stub):
    stub.CURRENT_SENDER["value"] = CLIENT


def _as_builder(stub):
    stub.CURRENT_SENDER["value"] = BUILDER


def _create_basic_project(release, stub, max_rc=3, deadline_offset=1_000_000, total=1000):
    _as_client(stub)
    pid = release.create_project(
        "p1", BUILDER, "Title", REPO_URL, DEPLOY_URL, max_rc, total, stub.CURRENT_TIME["value"] + deadline_offset
    )
    return pid


def _add_two_gates(release, project_id):
    release.add_gate(project_id, "quality", "Quality", "Code must pass CI with no TODOs left", "CODE_QUALITY", ["repo"], 4000, True, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")
    release.add_gate(project_id, "deploy", "Deploy", "Deployment must be live and match the RC commit", "DEPLOYMENT", ["deploy"], 6000, True, "quality", "MUST_MATCH_BOTH_PROJECT_HOSTS")


def _submit_rc(release, stub, project_id, commit="abc1234deadbeef", test_url=""):
    _as_builder(stub)
    return release.submit_release_candidate(project_id, commit, REPO_EVIDENCE, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, test_url)


def _satisfied_response(items, deployment_relation="UNCLEAR", finding="SATISFIED", commit_match="YES"):
    ev = ", ".join('{"source": "%s", "excerpt": "%s"}' % (s, e) for s, e in items)
    return (
        '{"finding": "%s", "commit_match": "%s", "deployment_relation": "%s", "evidence": [%s], "reason": "ok"}'
        % (finding, commit_match, deployment_relation, ev)
    )


# ---------------------------------------------------------------------------
# Project / gate definition
# ---------------------------------------------------------------------------

def test_create_project_requires_distinct_client_and_builder(release, stub):
    _as_client(stub)
    with pytest.raises(Exception):
        release.create_project("p1", CLIENT, "T", REPO_URL, DEPLOY_URL, 3, 1000, stub.CURRENT_TIME["value"] + 1000)


def test_create_project_rejects_past_deadline(release, stub):
    _as_client(stub)
    with pytest.raises(Exception):
        release.create_project("p1", BUILDER, "T", REPO_URL, DEPLOY_URL, 3, 1000, stub.CURRENT_TIME["value"] - 1)


def test_create_project_rejects_non_https_urls(release, stub):
    _as_client(stub)
    with pytest.raises(Exception):
        release.create_project("p1", BUILDER, "T", "http://insecure.example.com", DEPLOY_URL, 3, 1000, stub.CURRENT_TIME["value"] + 1000)


def test_add_gate_only_by_client(release, stub):
    pid = _create_basic_project(release, stub)
    stub.CURRENT_SENDER["value"] = OTHER
    with pytest.raises(Exception):
        release.add_gate(pid, "quality", "Quality", "Code must pass CI with no TODOs left", "CODE_QUALITY", ["repo"], 4000, True, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")


def test_add_gate_rejects_unknown_dependency(release, stub):
    pid = _create_basic_project(release, stub)
    with pytest.raises(Exception):
        release.add_gate(pid, "deploy", "Deploy", "Deployment must be live and match the RC commit", "DEPLOYMENT", ["deploy"], 10000, True, "quality", "MUST_MATCH_BOTH_PROJECT_HOSTS")


def test_lock_definition_requires_bps_sum_10000(release, stub):
    pid = _create_basic_project(release, stub)
    release.add_gate(pid, "quality", "Quality", "Code must pass CI with no TODOs left", "CODE_QUALITY", ["repo"], 4000, True, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")
    release.add_gate(pid, "deploy", "Deploy", "Deployment must be live and match the RC commit", "DEPLOYMENT", ["deploy"], 5000, True, "quality", "MUST_MATCH_BOTH_PROJECT_HOSTS")
    with pytest.raises(Exception):
        release.lock_definition(pid)


def test_add_gate_rejects_optional_gate(release, stub):
    """Every gate must be mandatory — an optional gate could leave its
    payment_bps share permanently trapped once the project reaches ACCEPTED
    (which only requires mandatory gates), since ACCEPTED projects cannot be
    refunded. This is rejected at add_gate, not merely at lock_definition."""
    pid = _create_basic_project(release, stub)
    with pytest.raises(Exception):
        release.add_gate(pid, "quality", "Quality", "Code must pass CI with no TODOs left", "CODE_QUALITY", ["repo"], 10000, False, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")


def test_add_gate_rejects_invalid_source_policy(release, stub):
    pid = _create_basic_project(release, stub)
    with pytest.raises(Exception):
        release.add_gate(pid, "quality", "Quality", "Code must pass CI with no TODOs left", "CODE_QUALITY", ["repo"], 10000, True, "", "free text is not a policy")


def test_definition_immutable_after_lock(release, stub):
    pid = _create_basic_project(release, stub)
    _add_two_gates(release, pid)
    release.lock_definition(pid)
    with pytest.raises(Exception):
        release.add_gate(pid, "extra", "Extra", "Some extra criterion long enough", "OTHER", ["repo"], 1, True, "", "MUST_MATCH_BOTH_PROJECT_HOSTS")
    with pytest.raises(Exception):
        release.lock_definition(pid)


def test_cancel_only_while_draft(release, stub):
    pid = _create_basic_project(release, stub)
    _add_two_gates(release, pid)
    release.lock_definition(pid)
    _as_client(stub)
    release.cancel_project(pid)
    assert release.get_project(pid).status == "CANCELLED"


# ---------------------------------------------------------------------------
# Release candidates
# ---------------------------------------------------------------------------

def _funded_project(release, stub, make_vault, **kwargs):
    pid = _create_basic_project(release, stub, **kwargs)
    _add_two_gates(release, pid)
    release.lock_definition(pid)
    vault = make_vault("REL_ADDR")
    stub.ContractAt.register("REL_ADDR", release)
    stub.ContractAt.register(VAULT_ADDR, vault)
    stub.CURRENT_SENDER["value"] = release.owner
    release.set_vault_address(VAULT_ADDR)
    total = kwargs.get("total", 1000)
    _as_client(stub)
    stub.CURRENT_VALUE["value"] = total
    vault.fund_project(pid)
    release.sync_funding_status(pid)
    return pid, vault


def test_only_builder_can_submit_rc(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    stub.CURRENT_SENDER["value"] = OTHER
    with pytest.raises(Exception):
        release.submit_release_candidate(pid, "abc1234deadbeef", REPO_EVIDENCE, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, "")


def test_rc_evidence_urls_cannot_all_be_identical(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _as_builder(stub)
    with pytest.raises(Exception):
        release.submit_release_candidate(pid, "abc1234deadbeef", REPO_EVIDENCE, REPO_EVIDENCE, REPO_EVIDENCE, "")


def test_max_rc_revisions_enforced(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault, max_rc=1)
    _submit_rc(release, stub, pid)
    _as_builder(stub)
    with pytest.raises(Exception):
        release.submit_release_candidate(pid, "def4567deadbeef", REPO_EVIDENCE, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, "")


def test_old_rc_remains_readable_after_new_revision(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault, max_rc=3)
    rc1 = _submit_rc(release, stub, pid, commit="abc1234deadbeef")
    rc2 = _submit_rc(release, stub, pid, commit="def4567deadbeef")
    old = release.get_rc(rc1)
    assert old.commit_sha == "abc1234deadbeef"
    new = release.get_rc(rc2)
    assert new.commit_sha == "def4567deadbeef"
    assert release.list_rc_ids(pid) == [rc1, rc2]


# ---------------------------------------------------------------------------
# Gate consensus
# ---------------------------------------------------------------------------

def test_gate_dependency_blocks_out_of_order_evaluation(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    with pytest.raises(Exception):
        release.evaluate_gate(pid, "deploy")


def test_satisfied_finding_unlocks_dependent_gate(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors and adds tests."
    stub.WEB_FIXTURES[DEPLOY_EVIDENCE] = "Build 1 is live running commit abc1234deadbeef."
    resp_q = _satisfied_response([("repo", "fixes lint errors and adds tests")])
    stub.PROMPT_QUEUE.extend([resp_q, resp_q])
    assert release.evaluate_gate(pid, "quality") == "SATISFIED"
    resp_d = _satisfied_response([("deploy", "is live running commit abc1234deadbeef")], deployment_relation="MATCHES_RC")
    stub.PROMPT_QUEUE.extend([resp_d, resp_d])
    assert release.evaluate_gate(pid, "deploy") == "SATISFIED"
    assert release.get_project(pid).status == "ACCEPTED"
    assert release.get_project(pid).accepted_rc_id == release.list_rc_ids(pid)[-1]


def test_deterministic_commit_scan_overrides_model_claim(release, stub, make_vault):
    """When the contract's own deterministic substring scan of the fetched
    repo page finds the RC's commit hash, that YES/NO verdict is binding —
    the model may only supply its own commit_match when the scan is
    itself UNCLEAR. Each scenario uses its own RC revision: a (project, gate,
    RC) evaluation is decided exactly once, so retrying against different
    evidence means submitting a new RC, not re-evaluating the same one."""
    pid, vault = _funded_project(release, stub, make_vault, max_rc=3)
    _submit_rc(release, stub, pid, commit="abc1234deadbeef")
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "This page never mentions any commit hash at all."
    resp = _satisfied_response([("repo", "never mentions any commit hash")], commit_match="YES")
    stub.PROMPT_QUEUE.extend([resp, resp])
    release.evaluate_gate(pid, "quality")
    finding = release.get_finding(pid, "quality", release.list_rc_ids(pid)[0])
    # deterministic scan was UNCLEAR (hash absent), so the model's own claim passes through
    assert finding.commit_match == "YES"

    stub.reset_fixtures()
    _submit_rc(release, stub, pid, commit="abc1234deadbeef")
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef is present verbatim on this page."
    resp2 = _satisfied_response([("repo", "is present verbatim on this page")], commit_match="NO")
    stub.PROMPT_QUEUE.extend([resp2, resp2])
    release.evaluate_gate(pid, "quality")
    finding2 = release.get_finding(pid, "quality", release.list_rc_ids(pid)[-1])
    # deterministic scan found the hash -> overrides the model's incorrect "NO" claim
    assert finding2.commit_match == "YES"


def test_evaluate_gate_is_immutable_once_recorded(release, stub, make_vault):
    """A (project, gate, RC revision) finding can never be re-evaluated —
    the fix for the audited bug where a later re-evaluation of the same RC
    could overwrite a SATISFIED finding with a worse one while leaving the
    vault's satisfied_rc authorization pointed at the now-contradicted RC."""
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    resp = _satisfied_response([("repo", "fixes lint errors")])
    stub.PROMPT_QUEUE.extend([resp, resp])
    assert release.evaluate_gate(pid, "quality") == "SATISFIED"
    with pytest.raises(Exception):
        release.evaluate_gate(pid, "quality")
    # satisfied_rc must still point at the one recorded finding, unchanged
    assert release.get_satisfied_rc_id(pid, "quality") == release.list_rc_ids(pid)[0]


def test_deterministic_commit_mismatch_yields_no(release, stub, make_vault):
    """A repo page that names a different full-length commit hash than the
    one claimed by the RC is a real mismatch (NO), not merely insufficient
    evidence (UNCLEAR) — and NOT_SATISFIED, not SATISFIED, since the gate
    requires repo evidence and commit_match must be YES to satisfy it."""
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid, commit="abc1234deadbeef")
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "This release is tagged at commit " + "f" * 40 + " only."
    resp = _satisfied_response([("repo", "This release is tagged at commit " + "f" * 40)], commit_match="YES")
    stub.PROMPT_QUEUE.extend([resp, resp])
    assert release.evaluate_gate(pid, "quality") == "NOT_SATISFIED"
    finding = release.get_finding(pid, "quality", release.list_rc_ids(pid)[0])
    assert finding.commit_match == "NO"


def test_satisfied_requires_material_checks_to_actually_pass(release, stub, make_vault):
    """A model cannot assert SATISFIED while its own commit_match/
    deployment_relation fields contradict it. The deploy gate here requires
    'deploy' evidence, so deployment_relation must be MATCHES_RC."""
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors and adds tests."
    stub.WEB_FIXTURES[DEPLOY_EVIDENCE] = "Build 1 is live running an older commit."
    resp_q = _satisfied_response([("repo", "fixes lint errors and adds tests")])
    stub.PROMPT_QUEUE.extend([resp_q, resp_q])
    release.evaluate_gate(pid, "quality")
    resp = _satisfied_response(
        [("deploy", "Build 1 is live running an older commit")],
        deployment_relation="STALE",
    )
    stub.PROMPT_QUEUE.extend([resp, resp])
    assert release.evaluate_gate(pid, "deploy") == "NOT_SATISFIED"
    finding = release.get_finding(pid, "deploy", release.list_rc_ids(pid)[0])
    assert finding.deployment_relation == "STALE"


def test_source_policy_violation_blocks_evaluation_without_model_call(release, stub, make_vault):
    """The 'quality' gate on _add_two_gates uses MUST_MATCH_BOTH_PROJECT_HOSTS
    (see _add_two_gates), so RC repo evidence hosted somewhere other than the
    project's registered repo_url host must be rejected deterministically —
    before any content is fetched or any model is called."""
    pid, vault = _funded_project(release, stub, make_vault)
    _as_builder(stub)
    off_host_repo_evidence = "https://gitlab.com/org/repo/commit/abc1234deadbeef"
    release.submit_release_candidate(pid, "abc1234deadbeef", off_host_repo_evidence, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, "")
    # No scripted prompt response is queued at all — if the policy check did
    # not short-circuit before the model call, exec_prompt would raise and
    # the finding would be INCONCLUSIVE, not the fail-closed NOT_SATISFIED
    # this deterministic rejection actually produces.
    assert release.evaluate_gate(pid, "quality") == "NOT_SATISFIED"
    finding = release.get_finding(pid, "quality", release.list_rc_ids(pid)[0])
    assert "source_policy" in finding.reason


def test_forged_excerpt_downgrades_to_inconclusive(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    forged = _satisfied_response([("repo", "this text was never on the page")])
    stub.PROMPT_QUEUE.extend([forged, forged])
    assert release.evaluate_gate(pid, "quality") == "INCONCLUSIVE"


def test_validator_disagreement_yields_inconclusive(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    resp_leader = _satisfied_response([("repo", "fixes lint errors")])
    resp_validator = _satisfied_response([("repo", "fixes lint errors")], finding="NOT_SATISFIED")
    stub.PROMPT_QUEUE.extend([resp_leader, resp_validator])
    assert release.evaluate_gate(pid, "quality") == "INCONCLUSIVE"


def test_source_unavailable_short_circuits_without_model_call(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FAILURES.add(REPO_EVIDENCE)
    assert release.evaluate_gate(pid, "quality") == "UNAVAILABLE"
    assert len(stub.PROMPT_QUEUE) == 0


def test_malformed_model_output_is_inconclusive(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    stub.PROMPT_QUEUE.extend(["not json at all", "not json at all"])
    assert release.evaluate_gate(pid, "quality") == "INCONCLUSIVE"


def test_new_rc_revision_requires_dependency_resatisfaction(release, stub, make_vault):
    """No mixing incompatible RC states: a gate satisfied on RC1 does not
    automatically unlock a dependent gate's evaluation against RC2."""
    pid, vault = _funded_project(release, stub, make_vault, max_rc=3)
    _submit_rc(release, stub, pid, commit="abc1234deadbeef")
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    resp = _satisfied_response([("repo", "fixes lint errors")])
    stub.PROMPT_QUEUE.extend([resp, resp])
    assert release.evaluate_gate(pid, "quality") == "SATISFIED"

    _submit_rc(release, stub, pid, commit="def4567deadbeef")
    with pytest.raises(Exception):
        release.evaluate_gate(pid, "deploy")


def test_evaluate_gate_requires_release_candidate(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    with pytest.raises(Exception):
        release.evaluate_gate(pid, "quality")


def test_evaluate_gate_rejects_unknown_gate(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault)
    _submit_rc(release, stub, pid)
    with pytest.raises(Exception):
        release.evaluate_gate(pid, "no-such-gate")


def test_final_acceptance_requires_same_rc_for_all_mandatory_gates(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault, max_rc=3)
    _submit_rc(release, stub, pid, commit="abc1234deadbeef")
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    resp = _satisfied_response([("repo", "fixes lint errors")])
    stub.PROMPT_QUEUE.extend([resp, resp])
    release.evaluate_gate(pid, "quality")
    assert release.get_project(pid).status != "ACCEPTED"

    _submit_rc(release, stub, pid, commit="def4567deadbeef")
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit def4567deadbeef fixes lint errors too."
    stub.WEB_FIXTURES[DEPLOY_EVIDENCE] = "Build 2 is live running commit def4567deadbeef."
    resp_q2 = _satisfied_response([("repo", "fixes lint errors too")])
    stub.PROMPT_QUEUE.extend([resp_q2, resp_q2])
    release.evaluate_gate(pid, "quality")
    resp_d2 = _satisfied_response([("deploy", "is live running commit def4567deadbeef")], deployment_relation="MATCHES_RC")
    stub.PROMPT_QUEUE.extend([resp_d2, resp_d2])
    release.evaluate_gate(pid, "deploy")
    assert release.get_project(pid).status == "ACCEPTED"
    assert release.get_project(pid).accepted_rc_id == release.list_rc_ids(pid)[-1]


# ---------------------------------------------------------------------------
# Expiry
# ---------------------------------------------------------------------------

def test_expire_project_requires_deadline_passed(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault, deadline_offset=1000)
    with pytest.raises(Exception):
        release.expire_project(pid)
    stub.CURRENT_TIME["value"] += 2000
    assert release.expire_project(pid) == "EXPIRED"


def test_expired_project_cannot_accept_new_rc(release, stub, make_vault):
    pid, vault = _funded_project(release, stub, make_vault, deadline_offset=1000)
    stub.CURRENT_TIME["value"] += 2000
    release.expire_project(pid)
    _as_builder(stub)
    with pytest.raises(Exception):
        release.submit_release_candidate(pid, "abc1234deadbeef", REPO_EVIDENCE, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, "")


def test_evaluate_gate_blocked_after_deadline_refund(release, stub, make_vault):
    """Once PatchrailVault has paid out the unearned remainder, no gate that
    wasn't already satisfied at that moment can ever be evaluated again —
    its payment_bps share is gone, so a SATISFIED finding produced after the
    fact would have nothing behind it."""
    pid, vault = _funded_project(release, stub, make_vault, deadline_offset=1000)
    _submit_rc(release, stub, pid)
    stub.CURRENT_TIME["value"] += 2000
    vault.refund_unearned(pid)
    with pytest.raises(Exception):
        release.evaluate_gate(pid, "quality")


# ---------------------------------------------------------------------------
# Source policy — evidence identity binding
# ---------------------------------------------------------------------------

def test_unrelated_same_host_repo_evidence_rejected(release, stub, make_vault):
    """Repo evidence hosted on the SAME host as the registered repository
    (github.com) but at a completely different org/repo path must still be
    rejected. Host equality alone is not proof of repository identity —
    binding must include the frozen repository path."""
    pid, vault = _funded_project(release, stub, make_vault)
    _as_builder(stub)
    unrelated_same_host = "https://github.com/some-other-org/unrelated-repo/commit/abc1234deadbeef"
    release.submit_release_candidate(pid, "abc1234deadbeef", unrelated_same_host, DEPLOY_EVIDENCE, RELEASE_EVIDENCE, "")
    assert release.evaluate_gate(pid, "quality") == "NOT_SATISFIED"
    finding = release.get_finding(pid, "quality", release.list_rc_ids(pid)[0])
    assert "source_policy" in finding.reason


def test_unrelated_same_host_deploy_evidence_rejected(release, stub, make_vault):
    """Same idea for deployment evidence: a different origin (different host
    or port) than the project's registered deploy_url must be rejected even
    when using MUST_MATCH_BOTH_PROJECT_HOSTS."""
    pid, vault = _funded_project(release, stub, make_vault)
    _as_builder(stub)
    wrong_port = "https://app.example.com:8443/build/1"
    release.submit_release_candidate(pid, "abc1234deadbeef", REPO_EVIDENCE, wrong_port, RELEASE_EVIDENCE, "")
    # deploy depends on quality, so quality must be satisfied first
    stub.WEB_FIXTURES[REPO_EVIDENCE] = "Commit abc1234deadbeef fixes lint errors."
    resp = _satisfied_response([("repo", "fixes lint errors")])
    stub.PROMPT_QUEUE.extend([resp, resp])
    release.evaluate_gate(pid, "quality")
    assert release.evaluate_gate(pid, "deploy") == "NOT_SATISFIED"
    finding = release.get_finding(pid, "deploy", release.list_rc_ids(pid)[0])
    assert "source_policy" in finding.reason
