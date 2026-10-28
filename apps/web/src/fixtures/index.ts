// Fixture mode: `VITE_FIXTURES=1` in a non-production build only (vite.config.ts drops it from
// production). The boards' example data is in boards.ts; each screen task answers its own API calls from it.
export function installFixtures(): void {
  document.documentElement.dataset.fixtureMode = 'on';
}
