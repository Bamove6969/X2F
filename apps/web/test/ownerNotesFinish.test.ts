import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Job 15: owner notes finish audit and questions', () => {
  const root = resolve(__dirname, '../../..');
  const auditPath = resolve(root, 'docs/owner-notes-status-2026-11-16.md');
  const questionsPath = resolve(root, 'docs/agy-owner-questions-notes-finish.md');

  it('documents/owner-notes-status-2026-11-16.md exists and closes all PARTLY and NOT DONE notes', () => {
    expect(existsSync(auditPath)).toBe(true);
    const content = readFileSync(auditPath, 'utf8');

    const partlyMatches = content.match(/-\s+\*\*PARTLY\*\*/g) || [];
    const notDoneMatches = content.match(/-\s+\*\*NOT DONE\*\*/g) || [];
    const ownerQMatches = content.match(/-\s+\*\*OWNER-QUESTION\*\*/g) || [];
    const closedMatches = content.match(/-\s+\*\*CLOSED/g) || [];
    const doneMatches = content.match(/-\s+\*\*DONE\*\*/g) || [];

    expect(partlyMatches.length).toBe(0);
    expect(notDoneMatches.length).toBe(0);
    expect(ownerQMatches.length).toBe(4);
    expect(closedMatches.length + doneMatches.length + ownerQMatches.length).toBe(91);
  });

  it('docs/agy-owner-questions-notes-finish.md exists and covers all questions with options and impact', () => {
    expect(existsSync(questionsPath)).toBe(true);
    const content = readFileSync(questionsPath, 'utf8');

    // Covers the key notes
    expect(content).toContain('26d861d0');
    expect(content).toContain('9859d59b');
    expect(content).toContain('6f7af3e7');
    expect(content).toContain('92778756');
    expect(content).toContain('75bfbd3c');
    expect(content).toContain('0b68b013');
    expect(content).toContain('8a11bb3d');
    expect(content).toContain('99e62425');
    expect(content).toContain('b851dfbf');

    // Ensures structured sections: Options and "What each would change"
    const optionsCount = (content.match(/###? Options|(\*\*Options:\*\*)/g) || []).length;
    const whatChangeCount = (content.match(/\*\*What each would change:\*\*/g) || []).length;

    expect(optionsCount).toBeGreaterThanOrEqual(8);
    expect(whatChangeCount).toBeGreaterThanOrEqual(8);
  });
});
