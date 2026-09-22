import { useCallback, useEffect, useState } from 'react';

const COLLAPSE_BELOW = 1280;
const FORCE_COLLAPSE_BELOW = 1024;

/**
 * Mirrors the reference SidebarContext exactly:
 * starts collapsed below 1280px, and any resize under 1024px forces collapse
 * (the rail becomes an off-canvas drawer there, so an open rail would cover
 * the page). Expanding again is always an explicit user action.
 */
export function useSidebar() {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < COLLAPSE_BELOW,
  );

  useEffect(() => {
    function onResize() {
      if (window.innerWidth < FORCE_COLLAPSE_BELOW) {
        setCollapsed(true);
      }
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggle = useCallback(() => setCollapsed((previous) => !previous), []);
  const close = useCallback(() => setCollapsed(true), []);

  /**
   * Below the drawer breakpoint the rail overlays the page, so choosing a
   * destination must dismiss it — otherwise the drawer hides the page the user
   * just navigated to. On wider viewports the rail is permanent and must not
   * collapse just because something was clicked.
   */
  const closeAfterNavigate = useCallback(() => {
    if (window.innerWidth < FORCE_COLLAPSE_BELOW) {
      setCollapsed(true);
    }
  }, []);

  return { collapsed, toggle, close, closeAfterNavigate };
}
