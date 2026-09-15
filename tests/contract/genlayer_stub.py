"""
Minimal local stand-in for the `genlayer` runtime, used ONLY by the pure-Python
unit tests in this directory.

This is NOT a GenVM emulator and does not replace live-network testing. It
exists so that patchrail_release.py / patchrail_vault.py — written against
the real stable py-genlayer 1jb45aa... runtime — can be imported and
exercised under pytest to unit-test their deterministic logic (hashing,
bounds checking, state machine transitions, value accounting) and to
simulate leader/validator agreement and disagreement, and native-GEN
transfer success/failure, with controllable fixtures.

Consensus itself (multi-validator voting, GenVM scheduling, real nondet web
fetch / LLM calls, and real value transfer) is stubbed:
- `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` calls leader_fn() once,
  then validator_fn(Return(leader_result)) once. If validation fails, it
  returns a non-Return sentinel (mirroring "no majority" -> contract treats
  as INCONCLUSIVE), exactly like the real contract's own handling.
- `gl.nondet.web.render` / `.get` / `gl.nondet.exec_prompt` read from a
  per-test registry so tests can script "what the model/web would have
  said" without a live network or LLM.
- `gl.get_contract_at(addr).emit_transfer(value=...)` records a transfer in
  TRANSFERS and raises if the target address is in TRANSFER_FAILURES, so
  tests can exercise the rollback-on-failed-transfer path.
"""

import sys
import types


# ---------------------------------------------------------------------------
# Test-controllable fixtures
# ---------------------------------------------------------------------------

WEB_FIXTURES: dict[str, str] = {}
WEB_SEQUENCES: dict[str, list] = {}
WEB_FAILURES: set[str] = set()
PROMPT_QUEUE: list[str] = []
TRANSFERS: list[tuple] = []
TRANSFER_FAILURES: set[str] = set()
CURRENT_TIME = {"value": 1_700_000_000}
CURRENT_SENDER = {"value": "0xAAAA000000000000000000000000000000AAAA"}
CURRENT_VALUE = {"value": 0}


def reset_fixtures():
    WEB_FIXTURES.clear()
    WEB_SEQUENCES.clear()
    WEB_FAILURES.clear()
    PROMPT_QUEUE.clear()
    TRANSFERS.clear()
    TRANSFER_FAILURES.clear()
    CURRENT_TIME["value"] = 1_700_000_000
    CURRENT_SENDER["value"] = "0xAAAA000000000000000000000000000000AAAA"
    CURRENT_VALUE["value"] = 0


# ---------------------------------------------------------------------------
# Storage primitives
# ---------------------------------------------------------------------------

class TreeMap(dict):
    pass


class DynArray(list):
    pass


class Address(str):
    def __new__(cls, value):
        return str.__new__(cls, str(value))


def u32(v):
    return int(v)


def u64(v):
    return int(v)


def u256(v):
    return int(v)


class bigint(int):
    def __new__(cls, v=0):
        return int.__new__(cls, int(v))

    def __add__(self, other):
        return bigint(int(self) + int(other))

    __radd__ = __add__

    def __sub__(self, other):
        return bigint(int(self) - int(other))

    def __rsub__(self, other):
        return bigint(int(other) - int(self))

    def __mul__(self, other):
        return bigint(int(self) * int(other))

    __rmul__ = __mul__

    def __floordiv__(self, other):
        return bigint(int(self) // int(other))


class _AnyMeta(type):
    def __getitem__(cls, item):
        return cls


class Any(metaclass=_AnyMeta):
    pass


def allow_storage(cls):
    return cls


# ---------------------------------------------------------------------------
# gl.vm
# ---------------------------------------------------------------------------

class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class _Disagreement:
    pass


class _Vm:
    Return = Return

    def get_current_transaction_time(self):
        return CURRENT_TIME["value"]

    def run_nondet_unsafe(self, leader_fn, validator_fn):
        try:
            leader_value = leader_fn()
        except Exception:
            return _Disagreement()
        leader_result = Return(leader_value)
        try:
            agreed = validator_fn(leader_result)
        except Exception:
            agreed = False
        if not agreed:
            return _Disagreement()
        return leader_result


class _WebNondet:
    def render(self, url, mode="text"):
        if url in WEB_FAILURES:
            raise RuntimeError(f"fetch failed for {url}")
        seq = WEB_SEQUENCES.get(url)
        if seq:
            return seq.pop(0)
        return WEB_FIXTURES.get(url, "")

    def get(self, url):
        return self.render(url)


class _Nondet:
    def __init__(self):
        self.web = _WebNondet()

    def exec_prompt(self, prompt, response_format="json"):
        if not PROMPT_QUEUE:
            raise RuntimeError("no scripted prompt response available")
        return PROMPT_QUEUE.pop(0)


class _Message:
    @property
    def sender_address(self):
        return Address(CURRENT_SENDER["value"])

    @property
    def value(self):
        return bigint(CURRENT_VALUE["value"])


class _TransferHandle:
    def __init__(self, address):
        self.address = str(address)

    def emit_transfer(self, value):
        if self.address in TRANSFER_FAILURES:
            raise RuntimeError(f"transfer to {self.address} failed")
        TRANSFERS.append((self.address, int(value)))


def get_contract_at(address):
    return _TransferHandle(address)


# ---------------------------------------------------------------------------
# gl.public decorators (no-op passthrough — the real runtime enforces the
# read/write/payable distinction at the GenVM boundary, not in Python
# semantics)
# ---------------------------------------------------------------------------

class _Write:
    def __call__(self, fn):
        return fn

    @staticmethod
    def payable(fn):
        return fn


class _Public:
    write = _Write()

    @staticmethod
    def view(fn):
        return fn


def contract_interface(cls):
    return cls


class _ContractAtRegistry:
    _registry: dict[str, object] = {}

    def register(self, address: str, instance):
        self._registry[str(address)] = instance

    def __call__(self, address):
        instance = self._registry.get(str(address))
        return _ContractAtHandle(instance)


class _ContractAtHandle:
    def __init__(self, instance):
        self._instance = instance

    def contract(self, _interface):
        return self

    def view(self):
        if self._instance is None:
            raise RuntimeError("no contract registered at this address")
        return self._instance

    def emit(self):
        if self._instance is None:
            raise RuntimeError("no contract registered at this address")
        return self._instance


ContractAt = _ContractAtRegistry()


class Contract:
    pass


class _GL(types.SimpleNamespace):
    pass


gl = _GL(
    Contract=Contract,
    public=_Public(),
    contract_interface=contract_interface,
    vm=_Vm(),
    nondet=_Nondet(),
    message=_Message(),
    ContractAt=ContractAt,
    get_contract_at=get_contract_at,
)


def install():
    """Install the fake `genlayer` module into sys.modules before importing contracts."""
    module = types.ModuleType("genlayer")
    names = {
        "gl": gl,
        "TreeMap": TreeMap,
        "DynArray": DynArray,
        "Address": Address,
        "u32": u32,
        "u64": u64,
        "u256": u256,
        "bigint": bigint,
        "Any": Any,
        "allow_storage": allow_storage,
    }
    for name, value in names.items():
        setattr(module, name, value)
    module.__all__ = list(names.keys())
    sys.modules["genlayer"] = module
    return module
