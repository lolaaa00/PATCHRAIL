import sys
import os
import importlib

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "contracts"))
sys.path.insert(0, os.path.dirname(__file__))

import genlayer_stub  # noqa: E402

genlayer_stub.install()

import patchrail_release  # noqa: E402
import patchrail_vault  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_stub():
    genlayer_stub.reset_fixtures()
    genlayer_stub.ContractAt._registry.clear()
    yield


@pytest.fixture
def release():
    importlib.reload(patchrail_release)
    return patchrail_release.PatchrailRelease()


@pytest.fixture
def make_vault():
    importlib.reload(patchrail_vault)

    def _make(release_address: str):
        return patchrail_vault.PatchrailVault(release_address)

    return _make


@pytest.fixture
def stub():
    return genlayer_stub
