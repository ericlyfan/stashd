import {
  Briefcase,
  Contact,
  FileSignature,
  Folder,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  LucideIcon,
  Plane,
  Receipt,
  Scale,
  Shield,
  Wrench,
} from 'lucide-react';

// Server-assigned icon slugs → lucide components. Anything unknown falls
// back to a folder.
const ICON_MAP: Record<string, LucideIcon> = {
  receipt: Receipt,
  'file-signature': FileSignature,
  'id-card': Contact,
  shield: Shield,
  'heart-pulse': HeartPulse,
  home: Home,
  briefcase: Briefcase,
  landmark: Landmark,
  scale: Scale,
  wrench: Wrench,
  'graduation-cap': GraduationCap,
  plane: Plane,
  folder: Folder,
};

export function categoryIcon(slug?: string): LucideIcon {
  return (slug && ICON_MAP[slug]) || Folder;
}

// For pickers: every icon slug the app knows how to render.
export const ICON_SLUGS = Object.keys(ICON_MAP);

// Slug, naming, and palette rules live in @stashd/shared so they can't drift
// from the server; re-exported under the names client code already uses.
export {
  categoryNameFromSlug as nameFromSlug,
  slugifyCategory as slugify,
  COLOR_PALETTE as CATEGORY_COLORS,
} from '@stashd/shared';
