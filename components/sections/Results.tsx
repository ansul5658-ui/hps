"use client";

import { motion } from "motion/react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import { RESULTS } from "@/lib/data";

export default function Results() {
  return (
    <section
      id="results"
      className="relative overflow-hidden bg-ink py-28 md:py-40"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-1/3 h-96 w-96 rounded-full bg-gold/10 blur-[130px]"
      />
      <div className="container-x relative">
        <SectionHeading
          eyebrow="Results & Success"
          title="Where effort meets the podium"
          subtitle="A consistent record of academic distinction and competitive excellence."
        />

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {RESULTS.map((board, bi) => (
            <Reveal key={board.category} delay={bi * 0.1} className="h-full">
              <div className="glass flex h-full flex-col rounded-3xl p-7">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-gold">
                  {board.category}
                </h3>
                <ul className="mt-6 flex flex-col gap-3">
                  {board.rows.map((row, ri) => (
                    <motion.li
                      key={row.name}
                      initial={{ opacity: 0, x: -20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: bi * 0.1 + ri * 0.08, duration: 0.6 }}
                      className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-4 transition-colors hover:border-gold/30"
                    >
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-lg font-bold ${
                          row.rank === "1"
                            ? "bg-gradient-to-br from-gold-light to-gold-deep text-ink"
                            : "border border-gold/40 text-gold"
                        }`}
                      >
                        {row.rank}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">
                          {row.name}
                        </p>
                        <p className="truncate text-xs text-white/50">
                          {row.detail}
                        </p>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
