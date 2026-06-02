"use client";

import { useEffect, useRef } from "react";

/**
 * A soft gold glow that trails the cursor with eased lerp motion,
 * plus a thin ring. Disabled on touch devices and reduced-motion.
 */
export default function MouseFollower() {
  const glowRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isTouch = window.matchMedia("(hover: none)").matches;
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (isTouch || prefersReduced) return;

    const glow = glowRef.current!;
    const ring = ringRef.current!;
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const glowPos = { ...target };
    const ringPos = { ...target };

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX;
      target.y = e.clientY;
    };

    const onInteractive = (e: Event) => {
      const el = (e.target as HTMLElement).closest(
        "a, button, [data-cursor='hover']"
      );
      ring.style.transform = `translate(-50%, -50%) scale(${el ? 1.8 : 1})`;
      ring.style.opacity = el ? "1" : "0.5";
    };

    let raf = 0;
    const lerp = (a: number, b: number, n: number) => a + (b - a) * n;
    const render = () => {
      glowPos.x = lerp(glowPos.x, target.x, 0.12);
      glowPos.y = lerp(glowPos.y, target.y, 0.12);
      ringPos.x = lerp(ringPos.x, target.x, 0.22);
      ringPos.y = lerp(ringPos.y, target.y, 0.22);
      glow.style.transform = `translate(${glowPos.x}px, ${glowPos.y}px)`;
      ring.style.left = `${ringPos.x}px`;
      ring.style.top = `${ringPos.y}px`;
      raf = requestAnimationFrame(render);
    };
    render();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerover", onInteractive);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerover", onInteractive);
    };
  }, []);

  return (
    <>
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] hidden h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full md:block"
        style={{
          background:
            "radial-gradient(circle, rgba(212,175,55,0.10), transparent 60%)",
          marginLeft: "-210px",
          marginTop: "-210px",
        }}
      />
      <div
        ref={ringRef}
        aria-hidden
        className="pointer-events-none fixed z-[61] hidden h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/70 transition-[transform,opacity] duration-200 md:block"
      />
    </>
  );
}
