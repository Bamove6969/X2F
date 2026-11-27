// Getting started's name checks (spec 6.1, FU-A): setup uses FU-A's rules from @x2f/auth-client
// (the FU-A tripwires that stood here until FU-A landed on 2026-10-28 are retired).
import * as client from '@x2f/auth-client';
import { describe, expect, it } from 'vitest';
import { checkTradeTag, checkLoginName, checkNames, checkNewTradeTag, checkNewLoginName } from '../src/screens/setup/names.js';
import { tradeTagOf } from '../src/session/useSession.js';

describe('setup takes the name rules from the typed client', () => {
  it('names.ts re-exports the client\'s own functions', () => {
    expect(checkNames).toBe(client.checkNames);
    expect(checkTradeTag).toBe(client.checkTradeTag);
    expect(checkLoginName).toBe(client.checkLoginName);
    expect(checkNewLoginName).toBe(client.checkNewLoginName);
    expect(checkNewTradeTag).toBe(client.checkNewTradeTag);
  });
});

describe("setup's name rules are FU-A's (@x2f/auth-client)", () => {
  it('stored names: 5-20 characters; the username ASCII letters, digits, dots, dashes, underscores', () => {
    expect(checkTradeTag('Mira.K_')).toEqual({ ok: true, name: 'Mira.K_', key: 'mira.k_' });
    expect(checkTradeTag('abcd')).toEqual({ ok: false, reason: 'length' });
    expect(checkTradeTag('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkTradeTag('a'.repeat(20)).ok).toBe(true);
    expect(checkLoginName('Mira K')).toEqual({ ok: false, reason: 'characters' });
    expect(checkLoginName('miraék')).toEqual({ ok: false, reason: 'characters' });
    expect(checkLoginName('x'.repeat(65))).toEqual({ ok: false, reason: 'length' });
  });

  it('signup round 3: the Trade Tag takes spaces, accents and common symbols, normalised', () => {
    expect(checkTradeTag('Mira  K$ ')).toEqual({ ok: true, name: 'Mira K$', key: 'mira k$' });
    expect(checkTradeTag('miraék')).toMatchObject({ ok: true });
    expect(checkTradeTag('mira\u200bk')).toEqual({ ok: false, reason: 'characters' });
  });

  it('reserved words and their look-alikes are refused for the Trade Tag only', () => {
    expect(checkTradeTag('x2f-team')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkTradeTag('adm1n.k')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkTradeTag('the.m0derator')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkTradeTag('rnod-desk')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkLoginName('admin-login').ok).toBe(true);
  });

  it('the two names must differ, ignoring case; the Trade Tag is checked first', () => {
    expect(checkNames('Lumen.Kai', 'lumen.kai')).toEqual({ ok: false, field: 'loginName', reason: 'same' });
    expect(checkNames('abc', 'lumen.kai')).toEqual({ ok: false, field: 'tradeTag', reason: 'length' });
    expect(checkNames('lumen.kai', 'abc')).toEqual({ ok: false, field: 'loginName', reason: 'length' });
    expect(checkNames('lumen.kai', 'lumen-login')).toMatchObject({ ok: true, display: { name: 'lumen.kai' }, login: { name: 'lumen-login' } });
  });

  it('owner demo notes #126 and #127: a new username and Trade Tag are 8-20 characters', () => {
    expect(checkNewLoginName('lumen.k')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewLoginName('lumen.ka')).toMatchObject({ ok: true });
    expect(checkNewTradeTag('Lumen.K')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewTradeTag('Lumen.Ka')).toMatchObject({ ok: true });
    expect(checkNames('lumen.k', 'lumen-login')).toEqual({ ok: false, field: 'tradeTag', reason: 'length' });
    expect(checkNames('lumen.kai', 'lumen.k')).toEqual({ ok: false, field: 'loginName', reason: 'length' });
    // Names stored before still parse (login lookups, profiles).
    expect(checkLoginName('lumen.k').ok).toBe(true);
    expect(checkTradeTag('Lumen.K').ok).toBe(true);
  });
});

describe('tradeTagOf', () => {
  it("reads FU-A's tradeTag exactly as stored", () => {
    expect(tradeTagOf({ tradeTag: 'Mira.K_' })).toBe('Mira.K_');
    expect(tradeTagOf({})).toBe('');
  });
});
