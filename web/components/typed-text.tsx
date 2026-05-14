"use client";

import { useEffect, useState } from "react";

// Types out each character with a tiny pause between lines. Used for the
// Otis introduction so the character feels like he's speaking.

export default function TypedText({
  lines,
  charDelay = 18,
  lineDelay = 380,
  startDelay = 600,
  className,
}: {
  lines: string[];
  charDelay?: number;
  lineDelay?: number;
  startDelay?: number;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState<string[]>(lines.map(() => ""));
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const startTimer = setTimeout(async () => {
      for (let i = 0; i < lines.length; i++) {
        const target = lines[i];
        for (let j = 0; j <= target.length; j++) {
          if (cancelled) return;
          await new Promise((r) => setTimeout(r, charDelay));
          setDisplayed((d) => {
            const next = [...d];
            next[i] = target.slice(0, j);
            return next;
          });
        }
        await new Promise((r) => setTimeout(r, lineDelay));
      }
      if (!cancelled) setDone(true);
    }, startDelay);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
    };
  }, [lines, charDelay, lineDelay, startDelay]);

  return (
    <div className={className}>
      {lines.map((line, i) => (
        <div key={i} className="min-h-[1.4em]">
          {displayed[i]}
          {!done && displayed[i].length === line.length && i < lines.length - 1 ? null : null}
          {!done && displayed[i].length < line.length ? (
            <span className="inline-block w-[0.55em] h-[1em] align-[-0.15em] bg-current ml-1 animate-pulse" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
