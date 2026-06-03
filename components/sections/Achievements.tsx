"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import SectionHeading from "@/components/ui/SectionHeading";
import { STATS } from "@/lib/data";

function Counter({
  value,
  suffix,
  start,
}: {
  value: number;
  suffix: string;
  start: boolean;
}) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!start) return;
    let raf = 0;
    const duration = 2000;
    const t0 = performance.now();
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setN(Math.floor(ease(p) * value));
      if (p < 1) raf = requestAnimationFrame(step);
      else setN(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [start, value]);

  return (
    <span className="tabular-nums">
      {n}
      {suffix}
    </span>
  );
}

export default function Achievements() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="achievements"
      className="relative overflow-hidden bg-ink py-28 md:py-36"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(212,175,55,1) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,1) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />
      <div className="container-x relative">
        <SectionHeading
          eyebrow="Achievements"
          title="Numbers that tell our story"
        />

        <div
          ref={ref}
          className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 md:grid-cols-4"
        >
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              className="group flex flex-col items-center justify-center gap-2 bg-ink-800 px-6 py-12 transition-colors hover:bg-ink-700"
              style={{ transitionDelay: `${i * 40}ms` }}
            >
              <div className="font-display text-5xl font-bold text-gradient-gold md:text-6xl">
                <Counter value={stat.value} suffix={stat.suffix} start={inView} />
              </div>
              <div className="text-center text-xs uppercase tracking-widest text-white/55">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
