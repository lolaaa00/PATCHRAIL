"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CANONICAL_CHAIN_ID } from "@/lib/genlayer/network";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export type WalletStatus =
  | "NOT_DETECTED"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "WRONG_NETWORK";

export type WalletState = {
  status: WalletStatus;
  address: `0x${string}` | null;
  chainId: number | null;
  provider: Eip1193Provider | null;
  error: string | null;
};

type WalletContextValue = WalletState & {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToStudionet: () => Promise<void>;
  isCorrectNetwork: boolean;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const STUDIONET_HEX = `0x${CANONICAL_CHAIN_ID.toString(16)}`;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: "DISCONNECTED",
    address: null,
    chainId: null,
    provider: null,
    error: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.ethereum) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time provider detection on mount
      setState((s) => ({ ...s, status: "NOT_DETECTED" }));
      return;
    }
    setState((s) => ({ ...s, provider: window.ethereum! }));
  }, []);

  const refreshChain = useCallback(async (provider: Eip1193Provider) => {
    const chainIdHex = (await provider.request({ method: "eth_chainId" })) as string;
    const chainId = parseInt(chainIdHex, 16);
    return chainId;
  }, []);

  const connect = useCallback(async () => {
    const provider = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!provider) {
      setState((s) => ({ ...s, status: "NOT_DETECTED", error: "No injected wallet detected" }));
      return;
    }
    setState((s) => ({ ...s, status: "CONNECTING", error: null }));
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const chainId = await refreshChain(provider);
      const address = accounts[0] as `0x${string}` | undefined;
      if (!address) {
        setState((s) => ({ ...s, status: "DISCONNECTED", error: "No account returned by wallet" }));
        return;
      }
      setState({
        status: chainId === CANONICAL_CHAIN_ID ? "CONNECTED" : "WRONG_NETWORK",
        address,
        chainId,
        provider,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Wallet connection failed";
      const rejected = /rejected|denied/i.test(message);
      setState((s) => ({
        ...s,
        status: "DISCONNECTED",
        error: rejected ? "USER_REJECTED" : message,
      }));
    }
  }, [refreshChain]);

  const disconnect = useCallback(() => {
    setState((s) => ({ ...s, status: "DISCONNECTED", address: null, chainId: null, error: null }));
  }, []);

  const switchToStudionet = useCallback(async () => {
    const provider = state.provider;
    if (!provider) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: STUDIONET_HEX }],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      // 4902 = chain not added to wallet yet
      if (message.includes("4902")) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: STUDIONET_HEX,
              chainName: "GenLayer Studionet",
              nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
              rpcUrls: ["https://studio.genlayer.com/api"],
              blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
            },
          ],
        });
      }
    }
  }, [state.provider]);

  useEffect(() => {
    const provider = state.provider;
    if (!provider) return;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts || accounts.length === 0) {
        setState((s) => ({ ...s, status: "DISCONNECTED", address: null, error: "ACCOUNT_REMOVED" }));
        return;
      }
      setState((s) => ({ ...s, address: accounts[0] as `0x${string}` }));
    };

    const handleChainChanged = (...args: unknown[]) => {
      const chainIdHex = args[0] as string;
      const chainId = parseInt(chainIdHex, 16);
      setState((s) => ({
        ...s,
        chainId,
        status: chainId === CANONICAL_CHAIN_ID ? "CONNECTED" : "WRONG_NETWORK",
      }));
    };

    const handleDisconnect = () => {
      setState((s) => ({ ...s, status: "DISCONNECTED", address: null, error: "PROVIDER_DISCONNECT" }));
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    provider.on("disconnect", handleDisconnect);
    return () => {
      provider.removeListener("accountsChanged", handleAccountsChanged);
      provider.removeListener("chainChanged", handleChainChanged);
      provider.removeListener("disconnect", handleDisconnect);
    };
  }, [state.provider]);

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      connect,
      disconnect,
      switchToStudionet,
      isCorrectNetwork: state.chainId === CANONICAL_CHAIN_ID,
    }),
    [state, connect, disconnect, switchToStudionet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
