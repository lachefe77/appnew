export function ProductPhoto({
  src,
  title,
  badge,
}: {
  src?: string | null;
  title: string;
  badge?: string | null;
}) {
  return (
    <div className="relative aspect-square overflow-hidden bg-[#eef0f2]">
      {src ? (
        <img src={src} alt={title} className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center px-4 text-center text-sm text-muted">Foto entra no cadastro do produto</div>
      )}
      {badge ? (
        <span className="absolute left-3 top-3 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-ink">{badge}</span>
      ) : null}
    </div>
  );
}
