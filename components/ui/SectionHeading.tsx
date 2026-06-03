"use client";

import Reveal from "./Reveal";

export default function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
}) {
  const alignment =
    align === "center" ? "items-center text-center" : "items-start text-left";
  return (
    <div className={`flex flex-col ${alignment} gap-4`}>
      <Reveal>
        <span className="eyebrow flex items-center gap-3">
          <span className="h-px w-8 bg-gold/60" />
          {eyebrow}
        </span>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="max-w-4xl text-balance font-display text-4xl font-semibold leading-tight text-white md:text-6xl">
          {title}
        </h2>
      </Reveal>
      {subtitle && (
        <Reveal delay={0.16}>
          <p className="max-w-2xl text-balance text-base text-white/60 md:text-lg">
            {subtitle}
          </p>
        </Reveal>
      )}
    </div>
  );
}
