/** A logger destination that keeps every line written to it. */
export function captureLogs(): { stream: { write(line: string): void }; logs: string[] } {
  const logs: string[] = [];
  return { logs, stream: { write: (line: string) => void logs.push(line) } };
}
