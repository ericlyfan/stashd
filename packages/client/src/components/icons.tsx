import { CategoryId } from '@stashd/shared';
import React from 'react';

interface IconProps {
  size?: number;
  style?: React.CSSProperties;
  className?: string;
}

const Icon = ({ size = 18, children, style = {}, ...rest }: IconProps & { children: React.ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
    {...rest}
  >
    {children}
  </svg>
);

export const IconInbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 13l2.5-7A2 2 0 0 1 7.4 4.6h9.2A2 2 0 0 1 18.5 6L21 13" />
    <path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
    <path d="M3 13h5l1.5 2h5L16 13h5" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Icon>
);

export const IconReceipt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </Icon>
);

export const IconContract = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v4h4" />
    <path d="M9 14c1-1 2-1 3 0s2 1 3 0" />
  </Icon>
);

export const IconID = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="12" r="2.5" />
    <path d="M14 10h4M14 13h3M6.5 16.5c.5-1.2 1.5-2 2.5-2s2 .8 2.5 2" />
  </Icon>
);

export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
  </Icon>
);

export const IconHeart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
  </Icon>
);

export const IconHome = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);

export const IconBriefcase = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    <path d="M3 13h18" />
  </Icon>
);

export const IconTax = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 8.5h-4.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H9" />
    <path d="M12 6v2M12 16v2" />
  </Icon>
);

export const IconScale = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v16" />
    <path d="M5 21h14" />
    <path d="M5 7l-2 5h4l-2-5zM19 7l-2 5h4l-2-5z" />
    <path d="M5 7h14" />
  </Icon>
);

export const IconWrench = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 3.5a4 4 0 0 0-5.4 5.4l-6.1 6.1a1.5 1.5 0 1 0 2.1 2.1l6.1-6.1a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.1-2.1 2.7-2.7z" />
  </Icon>
);

export const IconBook = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v17H5.5A1.5 1.5 0 0 1 4 18.5v-14z" />
    <path d="M20 4.5A1.5 1.5 0 0 0 18.5 3H13v17h5.5a1.5 1.5 0 0 0 1.5-1.5v-14z" />
  </Icon>
);

export const IconPlane = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 14l4-1 6 7 1.5-.5-2.5-7.5 4-1 2 2 1.5-.5-1-3.5 2-2-2-2-2 2-3.5-1-.5 1.5 2 2-1 4-7.5-2.5L4.5 9 3 13z" />
  </Icon>
);

export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </Icon>
);

export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l2.6 5.6 6 .9-4.4 4.2 1.1 6.1L12 16.9l-5.3 2.9 1.1-6.1L3.4 9.5l6-.9L12 3z" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);

export const IconSparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3z" />
    <path d="M19 15l.7 1.8L21.5 17.5l-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
  </Icon>
);

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
  </Icon>
);

export const IconChevron = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
);

export const IconX = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconEdit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4l11-11-4-4L4 16v4z" />
    <path d="M14 6l4 4" />
  </Icon>
);

export const IconMoreH = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconCamera = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="4" />
  </Icon>
);

export const IconArrowLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 6l-6 6 6 6" />
    <path d="M9 12h12" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);

export const IconDollar = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v18" />
    <path d="M16 7.5h-5a2.5 2.5 0 0 0 0 5h2a2.5 2.5 0 0 1 0 5H8" />
  </Icon>
);

export const IconBuilding = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
    <path d="M15 9h2a2 2 0 0 1 2 2v10" />
    <path d="M8 7h2M8 11h2M8 15h2" />
  </Icon>
);

export const IconNote = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 4a1 1 0 0 1 1-1h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4z" />
    <path d="M14 3v4h4M8 12h8M8 16h5" />
  </Icon>
);

export const IconRefresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
    <path d="M20 4v5h-5" />
    <path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
    <path d="M4 20v-5h5" />
  </Icon>
);

export const IconTag = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3h7l11 11-7 7-11-11V3z" />
    <circle cx="7" cy="7" r="1.5" />
  </Icon>
);

export type CategoryIconComponent = (p: IconProps) => JSX.Element;

export const CATEGORY_META: Record<CategoryId, { icon: CategoryIconComponent; color: string }> = {
  'receipts-expenses':     { icon: IconReceipt,   color: '#c8862c' },
  'contracts-agreements':  { icon: IconContract,  color: '#7a5cc8' },
  'identity-personal':     { icon: IconID,        color: '#3b6db8' },
  'insurance':             { icon: IconShield,    color: '#0d6f6a' },
  'medical-health':        { icon: IconHeart,     color: '#c4423a' },
  'property-construction': { icon: IconHome,      color: '#8a6e3a' },
  'business':              { icon: IconBriefcase, color: '#3a3a3c' },
  'tax-finance':           { icon: IconTax,       color: '#2e7e5b' },
  'legal':                 { icon: IconScale,     color: '#5a5a5c' },
  'warranties-manuals':    { icon: IconWrench,    color: '#c8704a' },
  'education':             { icon: IconBook,      color: '#3b8aa8' },
  'travel':                { icon: IconPlane,     color: '#7a8a3a' },
  'other':                 { icon: IconFolder,    color: '#6e6d6a' },
};

export function getCategoryMeta(id: string) {
  return CATEGORY_META[id as CategoryId] ?? { icon: IconFolder, color: '#6e6d6a' };
}
