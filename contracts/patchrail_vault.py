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
    remains claimable by the builder even after expiry.
"""

from dataclasses import dataclass
from genlayer import *


class PatchrailVault(gl.Contract):
    release_address: str
    funded: TreeMap[str, bool]
    deposited_amount: TreeMap[str, bigint]
    released_total: TreeMap[str, bigint]
    claimed: TreeMap[str, bool]
    claimed_amount: TreeMap[str, bigint]
    refunded: TreeMap[str, bool]
    refunded_amount: TreeMap[str, bigint]

    def __init__(self, release_address: str):
        if not release_address or len(release_address) < 4:
            raise Exception("A valid PatchrailRelease address is required")
        self.release_address = release_address
        self.funded = TreeMap()
        self.deposited_amount = TreeMap()
        self.released_total = TreeMap()
        self.claimed = TreeMap()
        self.claimed_amount = TreeMap()
        self.refunded = TreeMap()
        self.refunded_amount = TreeMap()

    def _now(self) -> u64:
        return u64(gl.vm.get_current_transaction_time())

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

    def _gate_payout_amount(self, project, release, gate_ids: list, gate_id: str) -> bigint:
        """Deterministic per-gate payout. Floor division on every gate's own
        `total * bps // 10000` share can leave a few wei of dust permanently
        unclaimable once the sum of floors is less than the sealed total.
        To guarantee the *entire* deposit is always eventually claimable (with
        exact equality once every gate is claimed), the deterministically
        last gate on the rail (highest order_index — by construction the
        final acceptance gate, since every gate is mandatory and this is the
        one gate that can only be satisfied once every other gate already
        is) is paid the exact remainder rather than its own floor share."""
        gates = [release.get_gate(project.project_id, gid) for gid in gate_ids]
        final_gate = max(gates, key=lambda g: int(g.order_index))
        if str(gate_id) == str(final_gate.gate_id):
            others_bps = sum(int(g.payment_bps) for g in gates if str(g.gate_id) != str(gate_id))
            others_amount = (project.total_payment_amount * bigint(others_bps)) // bigint(10000)
            return project.total_payment_amount - others_amount
        for g in gates:
            if str(g.gate_id) == str(gate_id):
                return (project.total_payment_amount * bigint(int(g.payment_bps))) // bigint(10000)
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
        deposited = self.deposited_amount.get(project_id, bigint(0))
        if current_released + amount > deposited:
            raise Exception("Claim would exceed the funded deposit — refusing to pay")

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
