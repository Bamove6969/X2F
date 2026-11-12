import { createContext } from 'react';

/** O-040: the owner's unread notifications count in the shell, and how to read it again (StaffShell sets it for the owner). */
export const AlertsCountContext = createContext<{ unread: number; refresh: () => void }>({ unread: 0, refresh: () => undefined });
