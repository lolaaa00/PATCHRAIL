import type { getReadClient } from "@/lib/genlayer/client";

type AnyClient = ReturnType<typeof getReadClient>;

export function vaultAdapter(client: AnyClient, address: `0x${string}`) {
  return {
    async isFunded(projectId: string): Promise<boolean> {
      return (await client.readContract({ address, functionName: "is_funded", args: [projectId] })) as unknown as boolean;
    },
    async getDeposit(projectId: string): Promise<bigint> {
      return (await client.readContract({ address, functionName: "get_deposit", args: [projectId] })) as unknown as bigint;
    },
    async getReleasedTotal(projectId: string): Promise<bigint> {
      return (await client.readContract({ address, functionName: "get_released_total", args: [projectId] })) as unknown as bigint;
    },
    async isClaimed(projectId: string, gateId: string): Promise<boolean> {
      return (await client.readContract({ address, functionName: "is_claimed", args: [projectId, gateId] })) as unknown as boolean;
    },
    async getClaimedAmount(projectId: string, gateId: string): Promise<bigint> {
      return (await client.readContract({
        address,
        functionName: "get_claimed_amount",
        args: [projectId, gateId],
      })) as unknown as bigint;
    },
    async getGatePayoutAmount(projectId: string, gateId: string): Promise<bigint> {
      return (await client.readContract({
        address,
        functionName: "get_gate_payout_amount",
        args: [projectId, gateId],
      })) as unknown as bigint;
    },
    async isRefunded(projectId: string): Promise<boolean> {
      return (await client.readContract({ address, functionName: "is_refunded", args: [projectId] })) as unknown as boolean;
    },
    async getRefundableEstimate(projectId: string): Promise<bigint> {
      return (await client.readContract({
        address,
        functionName: "get_refundable_estimate",
        args: [projectId],
      })) as unknown as bigint;
    },
    async fundProject(projectId: string, value: bigint): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "fund_project", args: [projectId], value });
    },
    async claimGate(projectId: string, gateId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "claim_gate", args: [projectId, gateId], value: 0n });
    },
    async refundUnearned(projectId: string): Promise<`0x${string}`> {
      return client.writeContract({ address, functionName: "refund_unearned", args: [projectId], value: 0n });
    },
  };
}

export type VaultAdapter = ReturnType<typeof vaultAdapter>;
