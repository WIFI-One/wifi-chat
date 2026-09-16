import React from 'react';

interface InfoPanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ isOpen, onClose, children }) => {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-fade-in"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed lg:relative inset-y-0 right-0 z-50 w-72 bg-chat-panel border-l border-chat-border
          transform transition-transform duration-300 ease-in-out lg:translate-x-0
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        aria-label="User information"
      >
        {children}
      </aside>
    </>
  );
};