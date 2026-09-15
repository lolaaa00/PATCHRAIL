"use client";

import { useWallet } from "@/lib/wallet/WalletContext";
import { shortHash } from "@/lib/genlayer/explorer";

export function WalletButton() {
  const wallet = useWallet();

  if (wallet.status === "NOT_DETECTED") {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="font-mono text-xs uppercase tracking-wide text-coral underline decoration-dotted"
      >
        Install a wallet
      </a>
    );
  }

  if (wallet.status === "CONNECTED") {
    return (
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-green lamp" aria-hidden />
        <span className="font-mono text-xs text-phosphor">{shortHash(wallet.address ?? "")}</span>
        <button onClick={wallet.disconnect} className="font-mono text-xs uppercase tracking-wide text-titanium underline">
          Disconnect
        </button>
      </div>
    );
  }

  if (wallet.status === "WRONG_NETWORK") {
    return (
      <button onClick={wallet.switchToStudionet} className="font-mono text-xs uppercase tracking-wide text-coral">
        Wrong network — switch to Studionet
      </button>
    );
  }

  return (
    <button
      onClick={wallet.connect}
      disabled={wallet.status === "CONNECTING"}
      className="border border-phosphor/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wide hover:border-phosphor hover:bg-phosphor/10 transition-colors disabled:opacity-50"
    >
      {wallet.status === "CONNECTING" ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
