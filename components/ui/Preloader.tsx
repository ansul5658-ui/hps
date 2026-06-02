"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SCHOOL } from "@/lib/data";

/**
 * Cinematic loading curtain: animated count, monogram reveal, then a
 * gold wipe that lifts to expose the hero. Locks scroll while active.
 */
export default function Preloader() {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("lenis-stopped");
    let current = 0;
    const tick = () => {
      current += Math.random() * 12 + 4;
      if (current >= 100) {
        current = 100;
        setProgress(100);
        setTimeout(() => {
          setDone(true);
          document.documentElement.classList.remove("lenis-stopped");
        }, 550);
        return;
      }
      setProgress(Math.floor(current));
      setTimeout(tick, 130 + Math.random() * 120);
    };
    const id = setTimeout(tick, 300);
    return () => {
      clearTimeout(id);
      document.documentElement.classList.remove("lenis-stopped");
    };
  }, []);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-ink"
          exit={{ y: "-100%" }}
          transition={{ duration: 0.9, ease: [0.76, 0, 0.24, 1] }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-24 w-24 items-center justify-center rounded-2xl border border-gold/40 text-3xl font-display font-bold text-gradient-gold"
          >
            SVM
          </motion.div>

          <p className="mt-6 text-xs uppercase tracking-cinematic text-white/50">
            {SCHOOL.name}
          </p>

          <div className="mt-10 h-px w-56 overflow-hidden bg-white/10">
            <motion.div
              className="h-full bg-gradient-to-r from-gold-deep to-gold-light"
              animate={{ width: `${progress}%` }}
              transition={{ ease: "easeOut" }}
            />
          </div>
          <div className="mt-3 font-display text-sm tabular-nums text-white/60">
            {progress}%
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
