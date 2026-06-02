"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import SectionHeading from "@/components/ui/SectionHeading";
import { CAMPUS } from "@/lib/data";

export default function CampusReveal() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".campus-card").forEach((card) => {
        const img = card.querySelector<HTMLElement>(".campus-img");
        const overlay = card.querySelector<HTMLElement>(".campus-meta");

        // Clip + blur reveal of each panel.
        gsap.fromTo(
          card,
          { clipPath: "inset(12% 12% 12% 12% round 24px)", filter: "blur(6px)" },
          {
            clipPath: "inset(0% 0% 0% 0% round 24px)",
            filter: "blur(0px)",
            ease: "power2.out",
            scrollTrigger: {
              trigger: card,
              start: "top 85%",
              end: "top 45%",
              scrub: true,
            },
          }
        );

        // Parallax on the image layer (scale + drift).
        if (img) {
          gsap.fromTo(
            img,
            { yPercent: -12, scale: 1.25 },
            {
              yPercent: 12,
              scale: 1.1,
              ease: "none",
              scrollTrigger: {
                trigger: card,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
              },
            }
          );
        }

        if (overlay) {
          gsap.from(overlay, {
            y: 40,
            opacity: 0,
            ease: "power3.out",
            scrollTrigger: { trigger: card, start: "top 70%" },
          });
        }
      });
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="campus"
      ref={root}
      className="relative bg-ink-900 py-28 md:py-40"
    >
      <div className="container-x">
        <SectionHeading
          eyebrow="Campus Reveal"
          title="A campus engineered for wonder"
          subtitle="Step through the spaces where ideas take shape — revealed one frame at a time."
        />

        <div className="mt-20 grid gap-6 md:grid-cols-2">
          {CAMPUS.map((item, i) => (
            <article
              key={item.title}
              className={`campus-card group relative h-[60vh] min-h-[360px] overflow-hidden rounded-3xl border border-white/10 ${
                i % 3 === 0 ? "md:col-span-2 md:h-[70vh]" : ""
              }`}
            >
              <div className="campus-img absolute inset-0 will-change-transform">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.image}
                  alt={item.title}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
              <div className="campus-meta absolute bottom-0 left-0 p-8">
                <span className="eyebrow">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 font-display text-3xl font-semibold text-white md:text-4xl">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm text-white/60">{item.caption}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
