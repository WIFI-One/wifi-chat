import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md';
  className?: string;
}

/** WifiChat logo: a circular message bubble with a wifi symbol inside. */
export const Logo: React.FC<LogoProps> = ({ size = 'md', className = '' }) => {
  const box = size === 'sm' ? 'w-8 h-8 rounded-full' : 'w-10 h-10 rounded-full';
  const icon = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  return (
    <div className={`${box} bg-white flex items-center justify-center flex-shrink-0 ${className}`}>
      <svg
        className={`${icon} text-black`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="10.5" r="7.5" />
        <path d="M8.2 16.8 6 20.5l3.9-1.9" />
        {/* Wifi icon geometry verbatim from wifi-svgrepo-com.svg (SVG Repo, CC0) */}
        <svg x="7.5" y="6.5" width="9" height="9" viewBox="0 0 48 48" fill="none">
          <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M30.7652,28.6157A10.5155,10.5155,0,0,0,17.33,28.5793v.0364"/>
            <circle cx="24" cy="33" r="4.5" fill="currentColor" stroke="none"/>
            <path d="M37.1783,21.3261a20.6755,20.6755,0,0,0-26.3145,0"/>
            <path d="M43.5,13.6741a30.5677,30.5677,0,0,0-39,0"/>
          </g>
        </svg>
      </svg>
    </div>
  );
};
