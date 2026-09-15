"use client";

import { motion } from "framer-motion";
import clsx from "clsx";

export type RailGate = {
  gate_id: string;
  label: string;
  state: "PENDING" | "SATISFIED" | "NOT_SATISFIED" | "INCONCLUSIVE" | "UNAVAILABLE";
};

const STATE_COLOR: Record<RailGate["state"], string> = {
  PENDING: "bg-titanium/30 border-titanium",
  SATISFIED: "bg-green border-green",
  NOT_SATISFIED: "bg-coral border-coral",
  INCONCLUSIVE: "bg-titanium/50 border-titanium",
  UNAVAILABLE: "bg-coral/60 border-coral",
};

/**
 * The page itself is the release rail: a commit line travels horizontally
 * through each gate. At each gate the line either locks (green, satisfied)
 * or halts (coral, blocked) — no dashboard cards, no gauges.
 */
export function GateRail({ gates }: { gates: RailGate[] }) {
  const lastSatisfiedIndex = gates.reduce((acc, g, i) => (g.state === "SATISFIED" ? i : acc), -1);
  const haltedIndex = gates.findIndex((g) => g.state === "NOT_SATISFIED" || g.state === "UNAVAILABLE");
  const travelIndex = haltedIndex === -1 ? lastSatisfiedIndex + 1 : haltedIndex;

  return (
    <div className="relative w-full overflow-x-auto py-10">
      <div className="relative flex min-w-[560px] items-center justify-between px-4">
        <div className="absolute left-4 right-4 top-1/2 h-px -translate-y-1/2 bg-titanium/25" aria-hidden />
        <motion.div
          className="absolute left-4 top-1/2 h-px -translate-y-1/2 bg-green"
          initial={{ width: 0 }}
          animate={{
            width: gates.length <= 1 ? 0 : `calc(${(Math.max(travelIndex, 0) / (gates.length - 1)) * 100}% - 2rem)`,
          }}
          transition={{ duration: 0.8, ease: "easeInOut" }}
          aria-hidden
        />
        {gates.map((gate, i) => (
          <div key={gate.gate_id} className="relative z-10 flex flex-col items-center gap-3">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.08 }}
              className={clsx(
                "h-4 w-4 rounded-full border-2 lamp",
                STATE_COLOR[gate.state],
                i === travelIndex && gate.state === "PENDING" && "animate-pulse",
              )}
              aria-hidden
            />
            <span className="max-w-[7rem] text-center font-mono text-[10px] uppercase tracking-wide text-titanium">
              {gate.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
