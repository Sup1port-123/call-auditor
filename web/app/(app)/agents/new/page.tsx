import Link from "next/link";
import AgentForm from "./agent-form";

export default function NewAgentPage() {
  return (
    <div className="px-10 lg:px-16 py-14 max-w-3xl">
      <Link
        href="/agents"
        className="text-xs uppercase tracking-[0.25em] text-zinc-400 hover:text-zinc-600 transition inline-block mb-6"
      >
        &larr; All agents
      </Link>

      <div className="mb-12">
        <div className="text-xs uppercase tracking-[0.25em] text-[var(--sky-700)] font-semibold mb-3">
          New agent
        </div>
        <h1 className="font-display text-5xl font-extrabold tracking-tight leading-[1.02]">
          Teach Otis a{" "}
          <span className="bg-gradient-to-r from-[var(--sky-700)] via-[var(--violet-500)] to-[var(--pink-500)] bg-clip-text text-transparent">
            new agent.
          </span>
        </h1>
        <p className="text-zinc-500 mt-4 max-w-xl">
          Give the agent a name, what it targets, and a knowledge base. Otis
          uses the KB to grade product-accuracy and compliance against real
          facts.
        </p>
      </div>

      <AgentForm />
    </div>
  );
}
