export function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 text-xs font-black uppercase tracking-widest text-white ${className}`}>
      <span className="size-1.5 animate-pulse rounded-full bg-white" />
      Live
    </span>
  );
}
