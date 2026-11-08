import { describe, expect, it } from 'vitest';
import { CANT_DO_TITLE, teamCantDoTitle } from '../src/ui/cantDoCodes.js';

// Design build review 7 Nov: the team refusal's title says why, not "This can't be done".
describe('teamCantDoTitle', () => {
  it('names who may do it, or why this device cannot', () => {
    expect(teamCantDoTitle('owner-only')).toBe('Only the owner can do this');
    expect(teamCantDoTitle('forbidden')).toBe("Your role doesn't include this");
    expect(teamCantDoTitle('weak-session')).toBe('Needs a Strong login');
    expect(teamCantDoTitle('too-many-members')).toBe(CANT_DO_TITLE.teamFull);
    expect(teamCantDoTitle('something-else')).toBe(CANT_DO_TITLE.team);
  });
});
