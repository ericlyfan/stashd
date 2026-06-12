export function formatBytes(bytes: number): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function relTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function formatAmount(amount?: number | null): string {
  if (amount === undefined || amount === null) return "";
  return amount.toLocaleString(undefined, {
    style: "currency",

    currency: "USD",
    minimumFractionDigits: 2,
  });
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isHeicMime(mime: string): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

export function fileKindLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/png") return "PNG";
  if (isHeicMime(mime)) return "HEIC";
  return mime.split("/").pop()?.toUpperCase() ?? "FILE";
}
