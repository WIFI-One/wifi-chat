import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface DropdownItem {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

interface DropdownProps {
  trigger: React.ReactElement;
  items: DropdownItem[];
  align?: 'left' | 'right';
}

export function Dropdown({ trigger, items, align = 'right' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (triggerRef.current?.contains(event.target as Node)) return;
      if (dropdownRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggle = () => setOpen(!open);
  const close = () => setOpen(false);

  const dropdownContent = open ? (
    <div
      ref={dropdownRef}
      className={`
        fixed z-[100] min-w-[160px] bg-gray-900 border border-gray-700 rounded-lg shadow-lg
        py-1 animate-slide-up
        ${align === 'right' ? 'right-0' : 'left-0'}
      `}
      role="menu"
    >
      {items.map((item, index) => (
        <button
          key={index}
          onClick={() => { item.onClick(); close(); }}
          disabled={item.disabled}
          className={`
            w-full px-3 py-2 text-left text-sm flex items-center gap-2
            hover:bg-gray-800 transition-colors
            ${item.danger ? 'text-red-400' : 'text-white'}
            ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          role="menuitem"
        >
          {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  const triggerWithRef = React.cloneElement(trigger, {
    ref: triggerRef,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
      trigger.props.onClick?.(e);
    },
  });

  return (
    <>
      {triggerWithRef}
      {dropdownContent && createPortal(dropdownContent, document.body)}
    </>
  );
}