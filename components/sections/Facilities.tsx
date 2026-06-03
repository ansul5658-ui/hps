"use client";

import { useRef } from "react";
import SectionHeading from "@/components/ui/SectionHeading";
import Reveal from "@/components/ui/Reveal";
import Icon from "@/components/ui/Icon";
import { FACILITIES } from "@/lib/data";

function TiltCard({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const rx = (py - 0.5) * -12;
    const ry = (px - 0.5) * 14;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`;
    el.style.setProperty("--mx", `${px * 100}%`);
    el.style.setProperty("--my", `${py * 100}%`);
  };

  const reset = () => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(900px) rotateX(0) rotateY(0)";
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      data-cursor="hover"
      className="group relative h-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl transition-[transform,box-shadow,border-color] duration-300 will-change-transform hover:border-gold/40 hover:shadow-glow-lg preserve-3d"
    >
      {/* Pointer-follow glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(360px circle at var(--mx,50%) var(--my,50%), rgba(212,175,55,0.18), transparent 60%)",
        }}
      />
      <div className="relative" style={{ transform: "translateZ(40px)" }}>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/30 bg-gold/10 text-gold">
          <Icon name={icon} />
        </div>
        <h3 className="mt-6 text-xl font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
      </div>
    </div>
  );
}

export default function Facilities() {
  return (
    <section
      id="facilities"
      className="relative bg-ink-900 py-28 md:py-40"
    >
      <div className="container-x">
        <SectionHeading
          eyebrow="Facilities"
          title="Everything a curious mind needs"
          subtitle="World-class infrastructure, thoughtfully designed for safety, focus and discovery."
        />

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FACILITIES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06} className="h-full">
              <TiltCard {...f} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
