import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export interface ScrollAreaHandle {
  scrollToBottom: () => void;
  scrollToTop: () => void;
  getScrollTop: () => number;
  getScrollHeight: () => number;
  getClientHeight: () => number;
}

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const ScrollArea = forwardRef<ScrollAreaHandle, ScrollAreaProps>(
  ({ className = '', children, ...props }, ref) => {
    const innerRef = useRef<HTMLDivElement>(null);
    
    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        innerRef.current?.scrollTo({ top: innerRef.current.scrollHeight, behavior: 'smooth' });
      },
      scrollToTop: () => {
        innerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      },
      getScrollTop: () => innerRef.current?.scrollTop || 0,
      getScrollHeight: () => innerRef.current?.scrollHeight || 0,
      getClientHeight: () => innerRef.current?.clientHeight || 0,
    }));
    
    return (
      <div
        ref={innerRef}
        className={`scrollbar-thin overflow-y-auto ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

ScrollArea.displayName = 'ScrollArea';