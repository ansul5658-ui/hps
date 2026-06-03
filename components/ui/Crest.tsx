import { SCHOOL } from "@/lib/data";

/**
 * The official Saraswati Vidya Mandir crest, framed as a medallion:
 * a gold ring + a dark gap that separates the crest's teal field from the
 * gold so it blends into the dark theme. Reused in nav, footer and preloader.
 */
export default function Crest({
  size = 44,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const gap = Math.max(2, Math.round(size * 0.055));
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-light via-gold to-gold-deep shadow-glow ${className}`}
      style={{ width: size, height: size, padding: gap }}
    >
      <span
        className="flex h-full w-full items-center justify-center rounded-full bg-ink-800"
        style={{ padding: gap }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt={`${SCHOOL.name} crest`}
          className="h-full w-full rounded-full object-cover"
        />
      </span>
    </span>
  );
}
