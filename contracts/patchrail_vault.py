# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""
PatchrailVault — the only contract in this product that ever custodies or
moves native GEN.

It holds one client's fixed total contract value per project, and releases
fixed milestone percentages strictly gated on PatchrailRelease's own,
GenLayer-validator-verified gate findings — read via `.view()` only, never
trusted from a caller-supplied claim. No model ever decides a raw GEN
amount: every non-final gate pays `total * gate_bps // 10000`, a deterministic
floor-division formula applied only after PatchrailRelease independently
reports a gate SATISFIED. The deterministically last gate on the rail (the
one with the highest order_index — every gate is mandatory, so this is
always the final acceptance gate) is instead paid the exact remainder after
all other gates' floors, so floor-division dust is never permanently
unclaimable: the full sealed total is always exactly claimable once every
gate is satisfied and claimed.

Value-safety rules enforced here:
  - exact-once funding (deposit must equal the sealed total, no more, no
    less; a project can be funded exactly once);
  - exact-once claiming per gate (a claimed gate can never be claimed again);
  - the beneficiary of every transfer is fixed by the release definition
    (builder for gate payouts, client for the unearned-remainder refund) —
    never the caller, never a model;
  - storage is updated before any value is sent, and rolled back if the
    transfer itself throws, so a failed transfer can be retried safely
    without ever double-crediting;
  - unearned remainder is only refundable once the project's deadline has
    passed and it was not already accepted, and only the portion belonging
    to gates that were never satisfied — a gate the builder already earned
    (satisfied, whether claimed yet or not) is carved out of the refund and
    remains claimable by the builder even after expiry;
  - once a deadline refund has paid out the unearned remainder, no gate that
    was not already satisfied at that moment can ever become claimable
    again: PatchrailRelease.evaluate_gate refuses to evaluate any gate for a
    project the vault reports as refunded, and claim_gate's own conservation
    check independently accounts for released + refunded + this claim
    against the deposit (not released + this claim alone), so the two
    defenses do not rely on each other to hold;
  - claim_gate's guard therefore enforces `released + refunded + new_claim
    <= deposited` for every claim, not merely `released + new_claim <=
    deposited` — the latter would ignore GEN that had already left the
    contract via refund and permit a double-spend against the same deposit.
"""

from dataclasses import dataclass
import time
from genlayer import *
from typing import Any  # imported after `from genlayer import *` — see the
# matching note in patchrail_release.py: the real GenVM runtime does not
# export Any from genlayer itself.


class PatchrailVault(gl.Contract):
    release_address: str
    funded: TreeMap[str, bool]
    deposited_amount: TreeMap[str, bigint]
    released_total: TreeMap[str, bigint]
    claimed: TreeMap[str, bool]
    claimed_amount: TreeMap[str, bigint]
    refunded: TreeMap[str, bool]
    refunded_amount: TreeMap[str, bigint]

    def __init__(self, release_address: Address):
        # `release_address` is deliberately an Address at the ABI boundary.
        # genlayer-js correctly recognizes a 0x-prefixed constructor argument
        # as the native GenVM address type; declaring this parameter as `str`
        # made a real deployment revert during constructor decoding even though
        # the rendered calldata looked like a string. Store its canonical text
        # form because ContractAt accepts that form and the rest of this
        # contract's storage/interface is string-based.
        release_address_text = str(release_address)
        if not release_address_text or len(release_address_text) < 4:
            raise Exception("A valid PatchrailRelease address is required")
        # Storage-typed fields (TreeMap[...] above) are auto-initialized by
        # the GenVM storage system from their class-level annotation — see
        # the matching note in patchrail_release.py's __init__.
        self.release_address = release_address_text

    def _now(self) -> u64:
        try:
            return u64(gl.vm.get_current_transaction_time())
        except AttributeError:
            return u64(int(time.time()))

    def _release(self):
        return gl.ContractAt(self.release_address).contract(IPatchrailRelease).view()

    def _claim_key(self, project_id: str, gate_id: str) -> str:
        return project_id + ":" + gate_id

    def _sum_bps(self, project_id: str) -> int:
        release = self._release()
        total = 0
        for gid in release.list_gate_ids(project_id):
            gate = release.get_gate(project_id, gid)
            total += int(gate.payment_bps)
        return total

    def _floor_share(self, total: bigint, bps: int) -> bigint:
        return (total * bigint(int(bps))) // bigint(10000)

    def _gate_payout_amount(self, project, release, gate_ids: list, gate_id: str) -> bigint:
        """Deterministic per-gate payout. Floor division on every gate's own
        `total * bps // 10000` share can leave a few wei of dust permanently
        unclaimable once the sum of floors is less than the sealed total.
        To guarantee the *entire* deposit is always eventually claimable (with
        exact equality once every gate is claimed), the deterministically
        last gate on the rail (highest order_index — by construction the
        final acceptance gate, since every gate is mandatory and this is the
        one gate that can only be satisfied once every other gate already
        is) is paid the exact remainder rather than its own floor share.

        That remainder must be computed as `total - sum(each other gate's own
        individually-floored share)`, NOT `total - floor(sum(other bps) *
        total // 10000)` — those two are not always equal (floor does not
        distribute over addition), and the combined-floor version can under-
        or over-count by exactly enough to break exact conservation on a
        small deposit. Example: bps 5000/2500/2500 over a deposit of 7:
        individual floors are 3/1/1 (sum 5, remainder 2); the combined
        calculation floors 7*7500//10000 = 5 for "the other two together",
        which also happens to be 5 here but is not guaranteed to match the
        sum of individual floors in general — summing the individual floors
        is the only version that is *always* exactly right."""
        gates = [release.get_gate(project.project_id, gid) for gid in gate_ids]
        final_gate = max(gates, key=lambda g: int(g.order_index))
        if str(gate_id) == str(final_gate.gate_id):
            others_sum = bigint(0)
            for g in gates:
                if str(g.gate_id) == str(gate_id):
                    continue
                others_sum += self._floor_share(project.total_payment_amount, g.payment_bps)
            return project.total_payment_amount - others_sum
        for g in gates:
            if str(g.gate_id) == str(gate_id):
                return self._floor_share(project.total_payment_amount, g.payment_bps)
        raise Exception("Gate does not exist")

    # ------------------------------------------------------------------
    # Funding — exact-once, defense-in-depth re-verified against Release
    # ------------------------------------------------------------------

    @gl.public.write.payable
    def fund_project(self, project_id: str) -> None:
        release = self._release()
        project = release.get_project(project_id)

        if self.funded.get(project_id, False):
            raise Exception("Project is already funded")
        if str(project.status) != "DRAFT":
            raise Exception("Project must be DRAFT (locked, unfunded) on PatchrailRelease to fund")
        if not bool(project.definition_locked):
            raise Exception("Project definition must be locked before funding")
        if gl.message.sender_address != project.client:
            raise Exception("Only the project's client can fund it")

        deposit = gl.message.value
        if deposit != project.total_payment_amount:
            raise Exception("Deposit must exactly equal the sealed total_payment_amount")

        if self._sum_bps(project_id) != 10000:
            raise Exception("Gate payment_bps on PatchrailRelease do not sum to 10000 — refusing to accept funds")

        self.funded[project_id] = True
        self.deposited_amount[project_id] = deposit
        self.released_total[project_id] = bigint(0)

    # ------------------------------------------------------------------
    # Claiming — deterministic formula, fixed beneficiary, exact-once
    # ------------------------------------------------------------------

    @gl.public.write
    def claim_gate(self, project_id: str, gate_id: str) -> bigint:
        if not self.funded.get(project_id, False):
            raise Exception("Project is not funded")
        key = self._claim_key(project_id, gate_id)
        if self.claimed.get(key, False):
            raise Exception("Gate has already been claimed")

        release = self._release()
        project = release.get_project(project_id)
        if not release.gate_is_satisfied(project_id, gate_id):
            raise Exception("Gate is not SATISFIED — nothing to claim")

        gate_ids = release.list_gate_ids(project_id)
        amount = self._gate_payout_amount(project, release, gate_ids, gate_id)
        current_released = self.released_total.get(project_id, bigint(0))
        current_refunded = self.refunded_amount.get(project_id, bigint(0))
        deposited = self.deposited_amount.get(project_id, bigint(0))
        # Conservation must hold across ALL outflows together, not just
        # released-so-far + this claim. Checking against deposited alone
        # (without subtracting what has already been refunded to the client)
        # would let a gate evaluated and satisfied *after* a deadline refund
        # still be claimed here as long as released+this-claim stayed under
        # the raw deposit total — even though the refunded portion is
        # already gone. PatchrailRelease.evaluate_gate independently refuses
        # to evaluate any gate once the vault reports is_refunded, so this is
        # deliberate defense-in-depth, not the only line of defense.
        if current_released + current_refunded + amount > deposited:
            raise Exception("Claim would exceed the funded deposit once released and refunded amounts are accounted for — refusing to pay")

        self.claimed[key] = True
        self.claimed_amount[key] = amount
        self.released_total[project_id] = current_released + amount

        if amount > bigint(0):
            try:
                gl.get_contract_at(project.builder).emit_transfer(value=u256(int(amount)))
            except Exception as e:
                self.claimed[key] = False
                self.claimed_amount[key] = bigint(0)
                self.released_total[project_id] = current_released
                raise Exception("Payout transfer failed, claim rolled back for retry: " + str(e))

        return amount

    # ------------------------------------------------------------------
    # Expiry refund — unearned remainder only; earned releases are final
    # ------------------------------------------------------------------

    def _reserved_unclaimed(self, project_id: str) -> bigint:
        release = self._release()
        project = release.get_project(project_id)
        gate_ids = release.list_gate_ids(project_id)
        reserved = bigint(0)
        for gid in gate_ids:
            key = self._claim_key(project_id, gid)
            if self.claimed.get(key, False):
                continue
            if release.gate_is_satisfied(project_id, gid):
                reserved += self._gate_payout_amount(project, release, gate_ids, gid)
        return reserved

    @gl.public.view
    def get_refundable_estimate(self, project_id: str) -> bigint:
        if not self.funded.get(project_id, False) or self.refunded.get(project_id, False):
            return bigint(0)
        deposited = self.deposited_amount.get(project_id, bigint(0))
        released = self.released_total.get(project_id, bigint(0))
        reserved = self._reserved_unclaimed(project_id)
        remainder = deposited - released - reserved
        return remainder if remainder > bigint(0) else bigint(0)

    @gl.public.write
    def refund_unearned(self, project_id: str) -> bigint:
        if not self.funded.get(project_id, False):
            raise Exception("Project is not funded")
        if self.refunded.get(project_id, False):
            raise Exception("Unearned remainder has already been refunded")

        release = self._release()
        project = release.get_project(project_id)
        status = str(project.status)
        if status == "ACCEPTED":
            raise Exception("Project was accepted — there is no unearned remainder to refund")
        if status != "EXPIRED" and self._now() <= project.deadline:
            raise Exception("Deadline has not passed yet")

        deposited = self.deposited_amount.get(project_id, bigint(0))
        released = self.released_total.get(project_id, bigint(0))
        reserved = self._reserved_unclaimed(project_id)
        refundable = deposited - released - reserved
        if refundable <= bigint(0):
            raise Exception("Nothing left to refund")

        self.refunded[project_id] = True
        self.refunded_amount[project_id] = refundable

        try:
            gl.get_contract_at(project.client).emit_transfer(value=u256(int(refundable)))
        except Exception as e:
            self.refunded[project_id] = False
            self.refunded_amount[project_id] = bigint(0)
            raise Exception("Refund transfer failed, rolled back for retry: " + str(e))

        return refundable

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @gl.public.view
    def is_funded(self, project_id: str) -> bool:
        return self.funded.get(project_id, False)

    @gl.public.view
    def get_deposit(self, project_id: str) -> bigint:
        return self.deposited_amount.get(project_id, bigint(0))

    @gl.public.view
    def get_released_total(self, project_id: str) -> bigint:
        return self.released_total.get(project_id, bigint(0))

    @gl.public.view
    def is_claimed(self, project_id: str, gate_id: str) -> bool:
        return self.claimed.get(self._claim_key(project_id, gate_id), False)

    @gl.public.view
    def get_claimed_amount(self, project_id: str, gate_id: str) -> bigint:
        return self.claimed_amount.get(self._claim_key(project_id, gate_id), bigint(0))

    @gl.public.view
    def is_refunded(self, project_id: str) -> bool:
        return self.refunded.get(project_id, False)

    @gl.public.view
    def get_refunded_amount(self, project_id: str) -> bigint:
        return self.refunded_amount.get(project_id, bigint(0))

    @gl.public.view
    def get_gate_payout_amount(self, project_id: str, gate_id: str) -> bigint:
        release = self._release()
        project = release.get_project(project_id)
        gate_ids = release.list_gate_ids(project_id)
        return self._gate_payout_amount(project, release, gate_ids, gate_id)


@gl.contract_interface
class IPatchrailRelease:
    def get_project(self, project_id: str) -> Any: ...
    def get_gate(self, project_id: str, gate_id: str) -> Any: ...
    def list_gate_ids(self, project_id: str) -> Any: ...
    def gate_is_satisfied(self, project_id: str, gate_id: str) -> bool: ...
    def get_satisfied_rc_id(self, project_id: str, gate_id: str) -> str: ...
