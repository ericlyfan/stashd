import { Category } from '@stashd/shared';

// Keyword → icon mapping for auto-created categories. First match wins.
const ICON_KEYWORDS: Array<[RegExp, string]> = [
  [/receipt|expense|invoice|purchase/, 'receipt'],
  [/contract|agreement|lease/, 'file-signature'],
  [/identity|personal|passport|license/, 'id-card'],
  [/insurance|policy/, 'shield'],
  [/medical|health|doctor|dental|prescription/, 'heart-pulse'],
  [/property|home|house|construction|real-estate|mortgage/, 'home'],
  [/business|work|employment|payroll/, 'briefcase'],
  [/tax|finance|bank|investment|statement/, 'landmark'],
  [/legal|court|law/, 'scale'],
  [/warranty|manual|appliance|repair/, 'wrench'],
  [/education|school|course|degree|certificate/, 'graduation-cap'],
  [/travel|flight|hotel|trip|visa/, 'plane'],
  [/utility|bill|electric|water|internet/, 'receipt'],
];

const COLOR_PALETTE = [
  '#0d9488', '#6366f1', '#f59e0b', '#3b82f6', '#ef4444',
  '#8b5cf6', '#0ea5e9', '#10b981', '#f97316', '#64748b',
  '#ec4899', '#14b8a6',
];

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function slugifyCategory(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'other';
}

export function categoryNameFromSlug(slug: string): string {
  return slug
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function buildCustomCategory(rawId: string): Category {
  const id = slugifyCategory(rawId);
  const iconMatch = ICON_KEYWORDS.find(([re]) => re.test(id));
  return {
    id,
    name: categoryNameFromSlug(id),
    icon: iconMatch ? iconMatch[1] : 'folder',
    color: COLOR_PALETTE[hashSlug(id) % COLOR_PALETTE.length],
    isCustom: true,
  };
}
