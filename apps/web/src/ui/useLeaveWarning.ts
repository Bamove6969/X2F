import { useEffect } from 'react';

/**
 * While `active`, leaving the page (closing the tab, reloading, navigating away from the app) asks
 * the browser's own "Leave site?" confirmation (lead call, gap 4, 20 Nov). For the moments this
 * device must stay online for money to move: between the seller's tap and `handedOff` (the no-show
 * refund and the release, both seller-built), and while the buyer's device co-signs a release. The
 * browser shows its own text; a page cannot set it. In-app links are not affected.
 */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
