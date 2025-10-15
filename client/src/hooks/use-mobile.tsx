import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Initialize to false for SSR, will be updated on client mount
  const [isMobile, setIsMobile] = React.useState<boolean>(false);

  React.useEffect(() => {
    // Ensure window exists before proceeding (client-side only logic)
    if (typeof window === 'undefined') {
      return;
    }

    const checkIsMobile = () => window.innerWidth < MOBILE_BREAKPOINT;

    // Set initial state based on current window size
    setIsMobile(checkIsMobile());

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(checkIsMobile());
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
