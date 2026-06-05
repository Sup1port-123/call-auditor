import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/audits", label: "Audits" },
  { href: "/batches", label: "Batches" },
  { href: "/agents", label: "Agents" },
  { href: "/new-audit", label: "New audit" },
  { href: "/settings", label: "Settings" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[var(--ink)]">
      <div className="grid grid-cols-[240px_1fr] min-h-screen">
        <aside className="border-r border-zinc-100 px-5 py-7 flex flex-col gap-1 bg-white sticky top-0 h-screen">
          <Link href="/" className="px-3 py-2 mb-5 flex items-center gap-3 group">
            <div className="relative w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-[var(--sky-200)] to-[var(--violet-200)] shrink-0">
              <Image
                src="/otis-character-cutout.png"
                alt="Otis"
                fill
                sizes="40px"
                className="object-cover object-top scale-[1.65] translate-y-0.5"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-display text-lg font-bold tracking-tight leading-none">
                otis<span className="text-[var(--sky-500)]">.</span>
              </span>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400 mt-1">
                AI call auditor
              </span>
            </div>
          </Link>

          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 px-3 mt-3 mb-2">
            Menu
          </div>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 rounded-lg text-sm text-zinc-700 hover:bg-zinc-100 hover:text-[var(--ink)] transition relative group"
            >
              {item.label}
            </Link>
          ))}

          <div className="mt-auto px-3 py-3 rounded-2xl bg-[var(--paper)] text-xs text-zinc-500 leading-relaxed">
            Drop a recording &mdash; I&apos;ll transcribe, score, and surface
            what worked.
          </div>
        </aside>
        <main className="overflow-x-hidden bg-white">{children}</main>
      </div>
    </div>
  );
}
