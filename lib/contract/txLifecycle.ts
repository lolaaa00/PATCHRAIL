"use client";

import { useCallback, useState } from "react";
import { CANONICAL_CHAIN_ID } from "@/lib/genlayer/network";

export type LifecycleStage =
  | "IDLE"
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "CONSENSUS_RUNNING"
  | "FINALIZED"
  | "EXECUTION_CONFIRMED"
  | "STATE_REREAD";

export type LifecycleFailure =
  | "USER_REJECTED"
  | "WRONG_NETWORK"
  | "RPC_ERROR"
  | "CONSENSUS_FAILURE"
  | "EXECUTION_ERROR"
  | "STATE_MISMATCH";

export type LifecycleState = {
  stage: LifecycleStage;
  failure: LifecycleFailure | null;
  txHash: `0x${string}` | null;
  errorMessage: string | null;
};

const INITIAL: LifecycleState = {
  stage: "IDLE",
  failure: null,
  txHash: null,
  errorMessage: null,
};

function classifyFailure(err: unknown): { failure: LifecycleFailure; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|user cancel/i.test(message)) {
    return { failure: "USER_REJECTED", message };
  }
  if (/chain|network/i.test(message)) {
    return { failure: "WRONG_NETWORK", message };
  }
  if (/consensus|validator/i.test(message)) {
    return { failure: "CONSENSUS_FAILURE", message };
  }
  if (/execution|revert|Exception/i.test(message)) {
    return { failure: "EXECUTION_ERROR", message };
  }
  if (/fetch|rpc|timeout|network error/i.test(message)) {
    return { failure: "RPC_ERROR", message };
  }
  return { failure: "RPC_ERROR", message };
}

export type WriteRunner = () => Promise<`0x${string}`>;
export type WaitRunner = (txHash: `0x${string}`) => Promise<{ status: "SUCCESS" | "ERROR"; message?: string }>;
export type RereadRunner = () => Promise<void>;

/**
 * Drives a single write through the full finality lifecycle. A tx hash is
 * never treated as success — the caller must supply a `wait` step that polls
 * GenLayer's own consensus/finality status, and a `reread` step that
 * re-fetches authoritative contract state after execution is confirmed.
 */
export function useTxLifecycle() {
  const [state, setState] = useState<LifecycleState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  const run = useCallback(
    async (opts: {
      chainId: number | null;
      write: WriteRunner;
      wait: WaitRunner;
      reread: RereadRunner;
    }): Promise<LifecycleState> => {
      setState({ stage: "AWAITING_SIGNATURE", failure: null, txHash: null, errorMessage: null });

      if (opts.chainId !== CANONICAL_CHAIN_ID) {
        const next: LifecycleState = {
          stage: "IDLE",
          failure: "WRONG_NETWORK",
          txHash: null,
          errorMessage: `Connected chain ${opts.chainId} is not Studionet (${CANONICAL_CHAIN_ID})`,
        };
        setState(next);
        return next;
      }

      let txHash: `0x${string}`;
      try {
        txHash = await opts.write();
      } catch (err) {
        const { failure, message } = classifyFailure(err);
        const next: LifecycleState = { stage: "IDLE", failure, txHash: null, errorMessage: message };
        setState(next);
        return next;
      }

      setState({ stage: "SUBMITTED", failure: null, txHash, errorMessage: null });
      setState({ stage: "CONSENSUS_RUNNING", failure: null, txHash, errorMessage: null });

      let result: { status: "SUCCESS" | "ERROR"; message?: string };
      try {
        result = await opts.wait(txHash);
      } catch (err) {
        const { failure, message } = classifyFailure(err);
        const next: LifecycleState = { stage: "SUBMITTED", failure, txHash, errorMessage: message };
        setState(next);
        return next;
      }

      if (result.status === "ERROR") {
        const next: LifecycleState = {
          stage: "FINALIZED",
          failure: "EXECUTION_ERROR",
          txHash,
          errorMessage: result.message ?? "Execution reverted",
        };
        setState(next);
        return next;
      }

      setState({ stage: "FINALIZED", failure: null, txHash, errorMessage: null });
      setState({ stage: "EXECUTION_CONFIRMED", failure: null, txHash, errorMessage: null });

      try {
        await opts.reread();
      } catch (err) {
        const { message } = classifyFailure(err);
        const next: LifecycleState = {
          stage: "EXECUTION_CONFIRMED",
          failure: "STATE_MISMATCH",
          txHash,
          errorMessage: message,
        };
        setState(next);
        return next;
      }

      const final: LifecycleState = { stage: "STATE_REREAD", failure: null, txHash, errorMessage: null };
      setState(final);
      return final;
    },
    [],
  );

  return { state, run, reset };
}
