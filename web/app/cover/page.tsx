"use client";

import Image from "next/image";
import { motion } from "motion/react";
import CoviPill from "@/components/covi-pill";

// Portfolio cover. Hit /cover, full-screen the browser, take a screenshot.
// Designed at 16:10 so it crops well into 1600×1000 / 1920×1200 / etc.
export default function CoverPage() {
  return (
    <main className="sky-bg w-screen h-screen overflow-hidden relative">
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />
      <div className="cloud cloud-d" />

      {/* faded OTIS wordmark behind everything */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 0.16, scale: 1 }}
        transition={{ duration: 1.2 }}
        aria-hidden
        className="font-display absolute inset-0 flex items-start justify-center pointer-events-none select-none"
      >
        <div className="text-[44vh] leading-[0.85] font-black text-white tracking-tight translate-y-[-10vh]">
          OTIS
        </div>
      </motion.div>

      <div className="relative z-10 h-full grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-8 md:gap-16 px-12 lg:px-24 py-12">
        {/* LEFT: character + pills */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, rotate: -3 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className="relative self-end max-w-[640px] mx-auto md:mx-0 aspect-[3/4]"
        >
          <motion.div
            animate={{
              y: [0, -10, 0],
              rotate: [-2, 2, -2],
            }}
            transition={{
              y: { duration: 6, repeat: Infinity, ease: "easeInOut" },
              rotate: { duration: 8, repeat: Infinity, ease: "easeInOut" },
            }}
            style={{ transformOrigin: "50% 85%" }}
            className="relative w-full h-full"
          >
            <Image
              src="/otis-character-cutout.png"
              alt="Otis"
              fill
              priority
              sizes="640px"
              className="object-contain drop-shadow-[0_30px_50px_rgba(56,142,215,0.25)]"
            />
          </motion.div>

          <CoviPill
            label="Listen"
            tone="sky"
            delay={0.4}
            className="absolute top-[14%] -left-2 md:-left-8 z-10"
          />
          <CoviPill
            label="Score"
            tone="violet"
            delay={0.7}
            className="absolute bottom-[18%] -right-2 md:-right-6 z-10"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.9 }}
            className="absolute top-[4%] right-[6%] bg-white rounded-2xl shadow-[0_12px_40px_-8px_rgba(15,23,42,0.18)] px-4 py-2.5 text-sm font-medium text-slate-800 speech z-10"
          >
            Hey, I&apos;m Otis 👋
          </motion.div>
        </motion.div>

        {/* RIGHT: copy block */}
        <div className="relative flex flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-[11px] uppercase tracking-[0.4em] text-cyan-700 font-semibold mb-5"
          >
            OTIS · AI Call Auditor
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="font-display text-[8vw] md:text-[6.5rem] lg:text-[7.5rem] leading-[0.9] font-extrabold text-slate-900 tracking-tight"
          >
            I listen.
            <br />
            I score.
            <br />
            <span className="bg-gradient-to-r from-sky-700 via-violet-500 to-pink-500 bg-clip-text text-transparent">
              I tell you what broke.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="text-slate-700 mt-6 max-w-md text-base lg:text-lg leading-relaxed"
          >
            A QA tool that transcribes AI agent calls with speaker
            diarization, grades them against a 10-dimension fintech rubric,
            and surfaces exactly where the agent nailed it &mdash; or
            fumbled.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.9 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            {[
              "Next.js",
              "TypeScript",
              "Supabase",
              "AssemblyAI",
              "Gemini",
              "Claude",
            ].map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/70 backdrop-blur border border-white/60 px-3 py-1.5 text-[11px] font-medium text-slate-700"
              >
                {t}
              </span>
            ))}
          </motion.div>
        </div>
      </div>

      {/* bottom-left footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.1 }}
        className="absolute bottom-8 left-12 text-[11px] uppercase tracking-[0.3em] text-slate-500 z-10"
      >
        2026 · case study
      </motion.div>

      {/* bottom-right mark */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.1 }}
        className="absolute bottom-8 right-12 text-[11px] uppercase tracking-[0.3em] text-slate-500 z-10"
      >
        Gromo
      </motion.div>
    </main>
  );
}
