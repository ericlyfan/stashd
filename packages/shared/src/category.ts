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

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

export function mimeFromExtension(filename: string, fallback = "application/octet-stream"): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? fallback;
}
