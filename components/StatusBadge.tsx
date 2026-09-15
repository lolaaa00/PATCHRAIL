import clsx from "clsx";

const TONE: Record<string, string> = {
  DRAFT: "border-titanium text-titanium",
  FUNDED: "border-blue text-blue",
  ACTIVE: "border-blue text-blue",
  RELEASE_CANDIDATE: "border-titanium text-phosphor",
  ACCEPTED: "border-green text-green",
  EXPIRED: "border-coral text-coral",
  CANCELLED: "border-coral text-coral",
  SATISFIED: "border-green text-green",
  NOT_SATISFIED: "border-coral text-coral",
  INCONCLUSIVE: "border-titanium text-titanium",
  UNAVAILABLE: "border-coral text-coral",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        TONE[status] ?? "border-titanium text-titanium",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current lamp" aria-hidden />
      {status}
    </span>
  );
}
