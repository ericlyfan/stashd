import React, { useState } from 'react';
import { IconSearch, IconX } from './icons';

interface TrafficLightsProps {
  onClose?: () => void;
}

export function TrafficLights({ onClose }: TrafficLightsProps) {
  const dot = (bg: string, key: string, onClick?: () => void) => (
    <button
      key={key}
      onClick={onClick}
      style={{
        width: 12, height: 12, borderRadius: '50%',
        background: bg, border: '0.5px solid rgba(0,0,0,0.12)',
        padding: 0, cursor: 'default',
      }}
    />
  );
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {dot('#ff5f57', 'r', onClose)}
      {dot('#febc2e', 'y')}
      {dot('#28c840', 'g')}
    </div>
  );
}

interface ToolbarProps {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
}

export function Toolbar({ left, center, right }: ToolbarProps) {
  return (
    <div style={{
      height: 44, display: 'flex', alignItems: 'center',
      padding: '0 14px', gap: 10,
      borderBottom: '0.5px solid var(--line)',
      background: 'rgba(255,255,255,0.7)',
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {left}
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        {center}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  onClick?: () => void;
  children: React.ReactNode;
  active?: boolean;
  title?: string;
}

export function ToolbarButton({ onClick, children, active, title }: ToolbarButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 26, padding: '0 8px',
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: active ? 'rgba(0,0,0,0.07)' : hovered ? 'rgba(0,0,0,0.05)' : 'transparent',
        border: 'none', borderRadius: 5,
        color: 'var(--ink-2)', fontSize: 12, fontWeight: 500,
        cursor: 'pointer',
        letterSpacing: -0.05,
      }}
    >
      {children}
    </button>
  );
}

interface PrimaryButtonProps {
  onClick?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export function PrimaryButton({ onClick, children, style = {}, disabled }: PrimaryButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 26, padding: '0 11px',
        background: 'var(--accent)', color: '#fff',
        border: 'none', borderRadius: 5,
        fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        cursor: disabled ? 'default' : 'pointer',
        letterSpacing: -0.05,
        boxShadow: '0 1px 1.5px rgba(13,111,106,0.25), inset 0 0.5px 0 rgba(255,255,255,0.3)',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

interface GhostButtonProps {
  onClick?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function GhostButton({ onClick, children, style = {} }: GhostButtonProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 26, padding: '0 10px',
        background: hovered ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.05)', color: 'var(--ink-2)',
        border: 'none', borderRadius: 5,
        fontSize: 12, fontWeight: 500,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        cursor: 'pointer',
        letterSpacing: -0.05,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
}

export function SearchField({ value, onChange, onSubmit, placeholder = 'Search documents' }: SearchFieldProps) {
  return (
    <div style={{
      width: 260, height: 26,
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '0 9px',
      background: 'rgba(0,0,0,0.05)',
      border: '0.5px solid rgba(0,0,0,0.06)',
      borderRadius: 5,
      color: 'var(--ink-3)',
    }}>
      <IconSearch size={12} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit?.(value.trim()); }}
        placeholder={placeholder}
        style={{
          flex: 1, border: 'none', background: 'transparent',
          outline: 'none', fontSize: 12, color: 'var(--ink)',
          letterSpacing: -0.05,
        }}
      />
      {value ? (
        <button
          onClick={() => onChange('')}
          style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: 0, display: 'flex' }}
        >
          <IconX size={11} />
        </button>
      ) : null}
    </div>
  );
}
