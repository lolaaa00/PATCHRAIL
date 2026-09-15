import Link from "next/link";
import { GateRail } from "@/components/GateRail";
import { Button } from "@/components/ui/Button";

const DEMO_GATES = [
  { gate_id: "quality", label: "Code Quality", state: "SATISFIED" as const },
  { gate_id: "docs", label: "Docs", state: "SATISFIED" as const },
  { gate_id: "deploy", label: "Deploy", state: "PENDING" as const },
  { gate_id: "final", label: "Final Acceptance", state: "PENDING" as const },
];

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24">
      <section className="pt-16 sm:pt-24">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-titanium">GenLayer Studionet · chain 61999</p>
        <h1 className="mt-6 max-w-3xl font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Ship what was agreed.
          <br />
          <span className="text-green">Release only what passes.</span>
        </h1>
        <p className="mt-6 max-w-xl text-titanium">
          Patchrail freezes a versioned acceptance rail before work starts. The builder submits an immutable
          release candidate; GenLayer validators independently inspect the repository and deployment evidence
          against semantic gate criteria; a separate vault releases fixed milestone GEN only after a gate is
          genuinely satisfied.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/new">
            <Button>Create a release rail</Button>
          </Link>
          <Link href="/me">
            <Button variant="secondary">View my projects</Button>
          </Link>
        </div>
      </section>

      <section className="mt-20 border border-phosphor/15 bg-phosphor/[0.03] p-6 sm:p-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-titanium">Example rail — illustrative</p>
        <GateRail gates={DEMO_GATES} />
      </section>

      <section className="mt-20 grid gap-8 sm:grid-cols-3">
        <Principle
          n="01"
          title="Fixed gates, sealed before work"
          body="Payment percentages and acceptance criteria are locked before the client funds the vault. No one can move the goalposts mid-build."
        />
        <Principle
          n="02"
          title="Consensus, not a single opinion"
          body="Every gate finding requires GenLayer validators to independently fetch evidence, classify it, and reach exact agreement — one operator's claim is never enough."
        />
        <Principle
          n="03"
          title="Deterministic settlement"
          body="The model never decides an amount. Payment is total × gate_bps ÷ 10000, released only after a gate is recorded SATISFIED, exactly once."
        />
      </section>
    </div>
  );
}

function Principle({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="border-t border-phosphor/15 pt-4">
      <p className="font-mono text-xs text-blue">{n}</p>
      <h3 className="mt-2 font-display text-lg font-medium">{title}</h3>
      <p className="mt-2 text-sm text-titanium">{body}</p>
    </div>
  );
}
