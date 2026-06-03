"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { gsap, ScrollTrigger } from "@/lib/gsap";

/**
 * Wires Lenis smooth scrolling into GSAP's ScrollTrigger so that every
 * pinned section, parallax layer and counter stays perfectly in sync with
 * the eased scroll position. Honours prefers-reduced-motion.
 */
export default function SmoothScroll({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReduced) {
      ScrollTrigger.refresh();
      return;
    }

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.5,
    });

    // Drive Lenis from GSAP's ticker for a single rAF loop.
    lenis.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    // Expose for anchor navigation.
    (window as Window & { __lenis?: Lenis }).__lenis = lenis;

    // Pinned sections are measured at mount; re-measure once the preloader
    // releases, fonts settle and lazy images load so positions stay correct.
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    const t1 = setTimeout(refresh, 700);
    const t2 = setTimeout(refresh, 2000);
    if (document.fonts?.ready) document.fonts.ready.then(refresh);

    return () => {
      gsap.ticker.remove(raf);
      window.removeEventListener("load", refresh);
      clearTimeout(t1);
      clearTimeout(t2);
      lenis.destroy();
      delete (window as Window & { __lenis?: Lenis }).__lenis;
    };
  }, []);

  return <>{children}</>;
}
