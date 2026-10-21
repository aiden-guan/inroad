import { ViewTransition, type ReactNode } from "react";

/**
 * Pages arrive with a short rise and leave with a quick fade (the browser's View Transitions API,
 * through React). Only route changes animate: `default="none"` keeps refreshes and in-page updates
 * still. CSS in globals.css; reduced motion turns it off. Browsers without support just navigate.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
