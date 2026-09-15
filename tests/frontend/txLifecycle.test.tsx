import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTxLifecycle } from "@/lib/contract/txLifecycle";
import { CANONICAL_CHAIN_ID } from "@/lib/genlayer/network";

describe("useTxLifecycle", () => {
  it("short-circuits on wrong network before calling write", async () => {
    const { result } = renderHook(() => useTxLifecycle());
    let write_called = false;
    await act(async () => {
      await result.current.run({
        chainId: 1,
        write: async () => {
          write_called = true;
          return "0xabc" as `0x${string}`;
        },
        wait: async () => ({ status: "SUCCESS" }),
        reread: async () => {},
      });
    });
    expect(write_called).toBe(false);
    expect(result.current.state.failure).toBe("WRONG_NETWORK");
  });

  it("classifies a rejected signature", async () => {
    const { result } = renderHook(() => useTxLifecycle());
    await act(async () => {
      await result.current.run({
        chainId: CANONICAL_CHAIN_ID,
        write: async () => {
          throw new Error("User rejected the request");
        },
        wait: async () => ({ status: "SUCCESS" }),
        reread: async () => {},
      });
    });
    expect(result.current.state.failure).toBe("USER_REJECTED");
  });

  it("treats a finalized execution error as failure, not success", async () => {
    const { result } = renderHook(() => useTxLifecycle());
    await act(async () => {
      await result.current.run({
        chainId: CANONICAL_CHAIN_ID,
        write: async () => "0xabc" as `0x${string}`,
        wait: async () => ({ status: "ERROR", message: "reverted" }),
        reread: async () => {},
      });
    });
    expect(result.current.state.stage).toBe("FINALIZED");
    expect(result.current.state.failure).toBe("EXECUTION_ERROR");
  });

  it("reaches STATE_REREAD on a full success path", async () => {
    const { result } = renderHook(() => useTxLifecycle());
    await act(async () => {
      await result.current.run({
        chainId: CANONICAL_CHAIN_ID,
        write: async () => "0xabc" as `0x${string}`,
        wait: async () => ({ status: "SUCCESS" }),
        reread: async () => {},
      });
    });
    expect(result.current.state.stage).toBe("STATE_REREAD");
    expect(result.current.state.failure).toBeNull();
  });

  it("reports STATE_MISMATCH when the post-execution reread fails", async () => {
    const { result } = renderHook(() => useTxLifecycle());
    await act(async () => {
      await result.current.run({
        chainId: CANONICAL_CHAIN_ID,
        write: async () => "0xabc" as `0x${string}`,
        wait: async () => ({ status: "SUCCESS" }),
        reread: async () => {
          throw new Error("stale read");
        },
      });
    });
    expect(result.current.state.stage).toBe("EXECUTION_CONFIRMED");
    expect(result.current.state.failure).toBe("STATE_MISMATCH");
  });
});
