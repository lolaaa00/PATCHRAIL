"use client";

import { ExternalLink } from "lucide-react";
import { explorerTxUrl } from "@/lib/genlayer/explorer";
import type { LifecycleState } from "@/lib/contract/txLifecycle";

const STEPS: { key: LifecycleState["stage"]; label: string }[] = [
  { key: "AWAITING_SIGNATURE", label: "Awaiting signature" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "CONSENSUS_RUNNING", label: "Consensus running" },
  { key: "FINALIZED", label: "Finalized" },
  { key: "EXECUTION_CONFIRMED", label: "Execution confirmed" },
  { key: "STATE_REREAD", label: "State re-read" },
];

const ORDER = STEPS.map((s) => s.key);

export function LifecycleTracker({ state }: { state: LifecycleState }) {
  if (state.stage === "IDLE" && !state.failure) return null;

  const currentIndex = ORDER.indexOf(state.stage);

  return (
    <div className="border border-phosphor/20 bg-phosphor/5 p-4">
      <ol className="flex flex-wrap gap-3">
        {STEPS.map((step, i) => {
          const reached = i <= currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <li
              key={step.key}
              className={`font-mono text-[11px] uppercase tracking-wide ${
                reached ? "text-phosphor" : "text-titanium/50"
              } ${isCurrent && !state.failure ? "underline decoration-blue decoration-2" : ""}`}
            >
              {step.label}
            </li>
          );
        })}
      </ol>
      {state.failure && (
        <p role="alert" className="mt-3 font-mono text-xs uppercase tracking-wide text-coral">
          {state.failure}: {state.errorMessage}
        </p>
      )}
      {state.txHash && (
        <a
          href={explorerTxUrl(state.txHash)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 font-mono text-xs text-blue underline"
        >
          View transaction on explorer
          <ExternalLink size={12} aria-hidden />
        </a>
      )}
    </div>
  );
}
