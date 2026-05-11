export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1a0b2e_0%,_#0a0612_60%)] text-white">
      <header className="border-b border-zinc-800/80 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight">Otis</span>
          <span className="text-xs text-zinc-500">dashboard</span>
        </div>
      </header>

      <section className="px-8 py-16 max-w-5xl mx-auto">
        <h1 className="text-3xl font-semibold">Welcome.</h1>
        <p className="text-zinc-400 mt-2">
          This is the new Otis dashboard shell. Real content lands in phase 2.
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Audits this week", value: "—" },
            { label: "Avg score", value: "—" },
            { label: "Agents tracked", value: "—" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6"
            >
              <div className="text-xs uppercase tracking-widest text-zinc-500">
                {card.label}
              </div>
              <div className="text-3xl font-semibold mt-2">{card.value}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
