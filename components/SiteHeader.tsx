import Link from "next/link";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/new", label: "New" },
  { href: "/me", label: "My projects" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-phosphor/15 bg-midnight/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-xl font-semibold tracking-tight">Patchrail</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-titanium sm:inline">
            release-acceptance rail
          </span>
        </Link>
        <nav aria-label="Primary" className="hidden gap-6 font-mono text-xs uppercase tracking-wide md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-blue">
              {item.label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </div>
    </header>
  );
}
