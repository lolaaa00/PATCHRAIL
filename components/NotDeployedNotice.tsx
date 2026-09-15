export function NotDeployedNotice({ contract }: { contract: string }) {
  return (
    <div className="border border-coral/60 bg-coral/5 p-4 font-mono text-xs uppercase tracking-wide text-coral">
      {contract} address is not configured. Set NEXT_PUBLIC_RELEASE_ADDRESS / NEXT_PUBLIC_VAULT_ADDRESS in
      .env.local after running scripts/deploy.ts against Studionet.
    </div>
  );
}
