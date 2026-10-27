export function ProductArt({ category, title }: { category: string; title: string }) {
  const tone = category === "pet" ? "#efe2cf" : category === "bem-estar" ? "#e4f0e8" : "#f8e3d8";
  const ink = category === "pet" ? "#8a5a2a" : category === "bem-estar" ? "#1e4a38" : "#c24d2c";
  return (
    <div className="relative aspect-[4/3] overflow-hidden" style={{ background: tone }}>
      <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label={title}>
        <circle cx="300" cy="60" r="70" fill={ink} opacity="0.12" />
        <rect x="48" y="78" width="180" height="120" rx="28" fill={ink} opacity="0.9" />
        <rect x="168" y="118" width="160" height="88" rx="24" fill="#fffaf3" />
        <path d="M78 150h70M78 170h46" stroke="#fffaf3" strokeWidth="8" strokeLinecap="round" />
      </svg>
      <span className="absolute left-3 top-3 rounded-full bg-white/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-ink">
        {category}
      </span>
    </div>
  );
}
