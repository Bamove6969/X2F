import type { ReactNode } from 'react';

// Stub for the shell (Task 13). Task 14 builds the Desktop board's frame in this file.
export function DesktopShell({ children }: { children: ReactNode }) {
  return <div data-shell="desktop">{children}</div>;
}
