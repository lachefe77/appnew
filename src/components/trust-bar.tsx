export function TrustBar({
  payments,
  promises,
}: {
  payments: string[];
  promises: string[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {payments.map((label) => (
          <span key={label} className="rounded-md border border-line bg-card px-2.5 py-1 text-xs font-semibold tracking-wide">
            {label}
          </span>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {promises.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    </div>
  );
}
