"use client";

import { useMemo } from "react";
import { getReadClient, createWriteClient } from "@/lib/genlayer/client";
import { RELEASE_ADDRESS, VAULT_ADDRESS, requireAddress } from "./addresses";
import { releaseAdapter } from "./release";
import { vaultAdapter } from "./vault";
import { useWallet } from "@/lib/wallet/WalletContext";

export function useDeploymentStatus() {
  return {
    releaseDeployed: Boolean(RELEASE_ADDRESS),
    vaultDeployed: Boolean(VAULT_ADDRESS),
  };
}

export function useReleaseRead() {
  return useMemo(() => {
    if (!RELEASE_ADDRESS) return null;
    const address = requireAddress(RELEASE_ADDRESS, "RELEASE_ADDRESS");
    return releaseAdapter(getReadClient(), address);
  }, []);
}

export function useVaultRead() {
  return useMemo(() => {
    if (!VAULT_ADDRESS) return null;
    const address = requireAddress(VAULT_ADDRESS, "VAULT_ADDRESS");
    return vaultAdapter(getReadClient(), address);
  }, []);
}

export function useReleaseWrite() {
  const wallet = useWallet();
  return useMemo(() => {
    if (!RELEASE_ADDRESS || !wallet.address || !wallet.provider || !wallet.isCorrectNetwork) return null;
    const address = requireAddress(RELEASE_ADDRESS, "RELEASE_ADDRESS");
    const client = createWriteClient(wallet.address, wallet.provider);
    return { client, adapter: releaseAdapter(client, address) };
  }, [wallet.address, wallet.provider, wallet.isCorrectNetwork]);
}

export function useVaultWrite() {
  const wallet = useWallet();
  return useMemo(() => {
    if (!VAULT_ADDRESS || !wallet.address || !wallet.provider || !wallet.isCorrectNetwork) return null;
    const address = requireAddress(VAULT_ADDRESS, "VAULT_ADDRESS");
    const client = createWriteClient(wallet.address, wallet.provider);
    return { client, adapter: vaultAdapter(client, address) };
  }, [wallet.address, wallet.provider, wallet.isCorrectNetwork]);
}
