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
  return formatMoney(amount, "USD");
}

// Format money in a given ISO currency (e.g. "CAD", "USD", "EUR"). Falls back to
// a plain number if the currency code is unknown/invalid so it never throws.
export function formatMoney(amount?: number | null, currency = "USD"): string {
  if (amount === undefined || amount === null) return "";
  try {
    return amount.toLocaleString(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    });
  } catch {
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
  }
}

// Compact large figures: 4.71T / 532.1B / 48.2M / 55,922 — for market caps and
// volumes, where full digits are noise. Prefix with "$" at the call site when
// it's money.
export function formatCompact(v?: number | null): string {
  if (v === undefined || v === null || v <= 0) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return Math.round(v).toLocaleString();
}

// Money for a dense table cell: an em dash for empty, else formatMoney.
export function formatMoneyCell(amount?: number | null, currency = "USD"): string {
  if (amount === undefined || amount === null) return "—";
  return formatMoney(amount, currency);
}

// Like formatAmount but renders an em dash for an empty/zero cell — for the
// dense money tables in the ledgers, where blank cells read as noise.
export function formatCell(amount?: number | null): string {
  if (amount === undefined || amount === null) return "—";
  return formatAmount(amount);
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function isHeicMime(mime: string): boolean {
  return mime === "image/heic" || mime === "image/heif";
}

const KIND_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "text/plain": "TXT",
  "text/markdown": "MD",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "text/csv": "CSV",
  "message/rfc822": "EML",
  "application/vnd.ms-outlook": "MSG",
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EMAIL_MIMES = ["message/rfc822", "application/vnd.ms-outlook"];

export function fileKindLabel(mime: string): string {
  if (KIND_LABELS[mime]) return KIND_LABELS[mime];
  if (isHeicMime(mime)) return "HEIC";
  return mime.split("/").pop()?.toUpperCase() ?? "FILE";
}

// Which viewer branch renders a given file type. Drives the Viewer's dispatch
// and the grid's thumbnail fallback. Grows as new previewable types land.
export type ViewerKind = "pdf" | "image" | "text" | "html" | "table" | "email";

export function viewerKind(mime: string): ViewerKind | null {
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain" || mime === "text/markdown") return "text";
  if (mime === DOCX_MIME) return "html";
  if (mime === XLSX_MIME || mime === "text/csv") return "table";
  if (EMAIL_MIMES.includes(mime)) return "email";
  if (isImageMime(mime) && !isHeicMime(mime)) return "image";
  return null;
}
