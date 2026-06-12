import { Category, categoryNameFromSlug, COLOR_PALETTE, slugifyCategory } from '@stashd/shared';

// Re-exported so route code has one import site for category naming rules.
export { categoryNameFromSlug, slugifyCategory };

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

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  }
  return h;
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
