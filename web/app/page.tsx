"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import TypedText from "@/components/typed-text";
import CoviPill from "@/components/covi-pill";

export default function LandingPage() {
  return (
    <main className="sky-bg min-h-screen relative">
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />
      <div className="cloud cloud-d" />

      <nav className="relative z-10 px-8 md:px-12 py-6 flex items-center justify-between">
        <div className="font-display text-lg md:text-xl font-bold text-slate-800 tracking-tight">
          otis<span className="text-cyan-500">.</span>
        </div>
        <Link
          href="/dashboard"
          className="hidden md:inline-flex text-sm font-medium text-slate-700 hover:text-slate-900 transition"
        >
          Open the auditor &rarr;
        </Link>
      </nav>

      <section className="relative z-10 px-6 md:px-12 pt-8 md:pt-16 pb-32 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.1fr] gap-8 md:gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.85, rotate: -3 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ scale: 1.02 }}
            className="relative"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 0.18, scale: 1 }}
              transition={{ duration: 1.4, delay: 0.1 }}
              aria-hidden
              className="font-display absolute -top-8 md:-top-16 -left-4 md:-left-12 right-0 text-[28vw] md:text-[18rem] leading-[0.85] font-black text-white tracking-tight pointer-events-none select-none"
            >
              OTIS
            </motion.div>

            <motion.div
              initial={{ rotate: 0, scale: 1 }}
              animate={{
                rotate: [-3, 3, -3],
                scale: [1, 1.015, 1],
                y: [0, -10, 0],
              }}
              transition={{
                rotate: { duration: 7, repeat: Infinity, ease: "easeInOut" },
                scale: { duration: 4, repeat: Infinity, ease: "easeInOut" },
                y: { duration: 6, repeat: Infinity, ease: "easeInOut" },
              }}
              style={{ transformOrigin: "50% 85%" }}
              className="relative max-w-[520px] mx-auto md:mx-0 aspect-[3/4]"
            >
              <Image
                src="/otis-character-cutout.png"
                alt="Otis, your AI call auditor"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 520px"
                className="object-contain drop-shadow-[0_30px_50px_rgba(56,142,215,0.25)]"
              />
            </motion.div>

            <CoviPill
              label="Listen"
              tone="sky"
              delay={1.0}
              driftFromX={-30}
              driftFromY={-10}
              className="absolute top-[18%] -left-2 md:-left-6 z-10"
            />
            <CoviPill
              label="Score"
              tone="violet"
              delay={1.4}
              driftFromX={30}
              driftFromY={10}
              className="absolute bottom-[16%] -right-2 md:-right-4 z-10"
            />

            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, delay: 1.8, ease: [0.22, 1, 0.36, 1] }}
              className="absolute top-[6%] right-[8%] bg-white rounded-2xl shadow-[0_12px_40px_-8px_rgba(15,23,42,0.18)] px-4 py-2.5 text-sm font-medium text-slate-800 speech z-10"
            >
              Hey, I&apos;m Otis 👋
            </motion.div>
          </motion.div>

          <div className="relative">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-xs uppercase tracking-[0.3em] text-cyan-600 font-semibold mb-5"
            >
              meet your AI call auditor
            </motion.div>

            <h1 className="font-display text-[10vw] md:text-[5.5rem] lg:text-[6.5rem] leading-[0.95] font-extrabold text-slate-900 tracking-tight">
              <TypedText
                lines={["I listen.", "I score.", "I tell you what broke."]}
                charDelay={32}
                lineDelay={250}
                startDelay={650}
                className="space-y-1"
              />
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 3.2 }}
              className="text-slate-600 mt-8 max-w-md text-base md:text-lg leading-relaxed"
            >
              Drop a recording, pick a preset. I transcribe with speaker
              diarization, grade every dimension of the call against your
              rubric, and surface exactly where the AI nailed it &mdash; or
              fumbled.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 3.5 }}
              className="mt-10 flex flex-wrap items-center gap-4"
            >
              <Link
                href="/new-audit"
                className="group inline-flex items-center gap-2 rounded-full bg-slate-900 px-8 py-3.5 text-base font-medium text-white hover:bg-slate-800 transition shadow-[0_10px_40px_-12px_rgba(15,23,42,0.5)] hover:shadow-[0_14px_50px_-10px_rgba(15,23,42,0.6)]"
              >
                Audit a call
                <span className="transition-transform group-hover:translate-x-1">
                  &rarr;
                </span>
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full bg-white/70 backdrop-blur px-7 py-3.5 text-base font-medium text-slate-800 hover:bg-white transition border border-slate-200"
              >
                See past audits
              </Link>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 3.8 }}
              className="mt-12 flex items-center gap-6 text-xs text-slate-500"
            >
              <Stat n="10" l="rubric dimensions" />
              <span className="w-px h-8 bg-slate-300" />
              <Stat n="5" l="audit presets" />
              <span className="w-px h-8 bg-slate-300" />
              <Stat n="2" l="LLM providers" />
            </motion.div>
          </div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 -mt-16 px-6 md:px-12 max-w-6xl mx-auto pb-24"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FeatureCard
            badge="01"
            title="Hear every word."
            body="AssemblyAI transcription with speaker diarization. Hindi, English, Hinglish, code-switched — Otis handles it."
          />
          <FeatureCard
            badge="02"
            title="Score the whole call."
            body="Ten rubric dimensions: opening, discovery, objection handling, compliance, tone, flow, closing, and more."
          />
          <FeatureCard
            badge="03"
            title="Know what to fix."
            body="Strengths. Misses. Concrete recommendations the AI team can act on next week."
          />
        </div>
      </motion.section>
    </main>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <div className="text-2xl font-display font-bold text-slate-900 leading-none">
        {n}
      </div>
      <div className="text-[10px] uppercase tracking-widest mt-1 text-slate-500">
        {l}
      </div>
    </div>
  );
}

function FeatureCard({
  badge,
  title,
  body,
}: {
  badge: string;
  title: string;
  body: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -6 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="rounded-3xl bg-white/80 backdrop-blur-md border border-white/60 p-7 shadow-[0_10px_40px_-20px_rgba(15,23,42,0.25)]"
    >
      <div className="text-xs font-mono text-slate-400 mb-3">{badge}</div>
      <div className="font-display text-xl font-bold text-slate-900 mb-2">
        {title}
      </div>
      <div className="text-sm text-slate-600 leading-relaxed">{body}</div>
    </motion.div>
  );
}
