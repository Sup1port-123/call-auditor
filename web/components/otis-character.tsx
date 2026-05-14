"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

type Expression = "neutral" | "smile" | "blink" | "surprised" | "side";

const EXPRESSIONS: Expression[] = [
  "neutral",
  "smile",
  "blink",
  "surprised",
  "side",
];

// Each expression file is preloaded; we toggle opacity to crossfade.
// The schedule below makes Otis blink every ~5–7s and occasionally cycle
// through smile/surprised/side. Hover always shows smile (highest priority).
export default function OtisCharacter() {
  const [scheduled, setScheduled] = useState<Expression>("neutral");
  const [hovered, setHovered] = useState(false);
  const current: Expression = hovered ? "smile" : scheduled;

  useEffect(() => {
    let stopped = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const run = async () => {
      while (!stopped) {
        // Idle window
        await sleep(3500 + Math.random() * 2500);
        if (stopped) return;

        // 25% chance for an expressive cycle, else blink
        if (Math.random() < 0.25) {
          const pool: Expression[] = ["smile", "surprised", "side"];
          const pick = pool[Math.floor(Math.random() * pool.length)];
          setScheduled(pick);
          await sleep(1400 + Math.random() * 600);
          if (stopped) return;
        } else {
          setScheduled("blink");
          await sleep(160 + Math.random() * 80);
          if (stopped) return;
          // Sometimes a double blink
          if (Math.random() < 0.2) {
            setScheduled("neutral");
            await sleep(120);
            if (stopped) return;
            setScheduled("blink");
            await sleep(160);
            if (stopped) return;
          }
        }

        setScheduled("neutral");
      }
    };

    run();
    return () => {
      stopped = true;
    };
  }, []);

  return (
    <motion.div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
      className="relative max-w-[520px] mx-auto md:mx-0 aspect-[3/4] cursor-pointer"
    >
      {EXPRESSIONS.map((e) => (
        <Image
          key={e}
          src={`/otis-expressions/${e}.png`}
          alt="Otis"
          fill
          priority={e === "neutral"}
          sizes="(max-width: 768px) 100vw, 520px"
          className={`object-contain transition-opacity duration-[400ms] ease-out drop-shadow-[0_30px_50px_rgba(56,142,215,0.25)] ${
            e === current ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </motion.div>
  );
}
