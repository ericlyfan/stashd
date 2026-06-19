// Helpers shared verbatim by client and server so slug, naming, palette, and
// mime rules can never drift between the two.

export function slugifyCategory(raw: string): string {
  return (
    raw
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "other"
  );
}

export function categoryNameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// Palette used for auto-assigned category colors and the client color picker.
export const COLOR_PALETTE = [
  "#0d9488", "#6366f1", "#f59e0b", "#3b82f6", "#ef4444",
  "#8b5cf6", "#0ea5e9", "#10b981", "#f97316", "#64748b",
  "#ec4899", "#14b8a6",
];

// The single source of truth for which file types Stash'd accepts and what
// mime each maps to. Acceptance (client + server gates) is derived from this
// map's keys, so adding a type here is what makes it uploadable. Browser-
// reported mimes are unreliable for office/email formats, so the whole
// pipeline resolves mime from the extension instead.
const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
};

export function mimeFromExtension(filename: string, fallback = "application/octet-stream"): string {
  return MIME_BY_EXT[extensionOf(filename)] ?? fallback;
}

export function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

// Every extension Stash'd accepts, derived from the mime map.
export const SUPPORTED_EXTENSIONS = Object.keys(MIME_BY_EXT);

export function isSupportedFilename(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(filename));
}
