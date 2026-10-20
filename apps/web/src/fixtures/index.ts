// Fixture mode: `VITE_FIXTURES=1` in a non-production build only (vite.config.ts drops it from
// production). Task 15 adds the board data (boards.ts) and answers API calls from it.
export function installFixtures(): void {
  document.documentElement.dataset.fixtureMode = 'on';
}
