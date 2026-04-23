import { describe, it, expect, beforeEach } from 'vitest';
import {
  fmtBytes,
  fmtDate,
  baseForRemote,
  setActiveRemote,
  getActiveRemote,
} from './api';

// ── fmtBytes ──────────────────────────────────────────────────────────────────

describe('fmtBytes', () => {
  it('returns "0 B" for zero', () => {
    expect(fmtBytes(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(fmtBytes(512)).toBe('512.0 B');
  });

  it('formats kilobytes', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB');
  });

  it('formats megabytes', () => {
    expect(fmtBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('formats gigabytes', () => {
    expect(fmtBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('formats terabytes', () => {
    expect(fmtBytes(1024 ** 4)).toBe('1.0 TB');
  });

  it('rounds to one decimal place', () => {
    expect(fmtBytes(1536)).toBe('1.5 KB');
  });
});

// ── fmtDate ───────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
  it('returns em-dash for empty string', () => {
    expect(fmtDate('')).toBe('—');
  });

  it('returns em-dash for Go zero time', () => {
    expect(fmtDate('0001-01-01T00:00:00Z')).toBe('—');
  });

  it('returns a non-empty string for a valid ISO date', () => {
    const result = fmtDate('2024-06-15T12:00:00Z');
    expect(result).not.toBe('—');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── baseForRemote ─────────────────────────────────────────────────────────────

describe('baseForRemote', () => {
  it('returns /api/1.0 for local', () => {
    expect(baseForRemote('local')).toBe('/api/1.0');
  });

  it('returns remote proxy path for named remote', () => {
    expect(baseForRemote('prod')).toBe('/api/remotes/prod/1.0');
  });

  it('percent-encodes remote names with special characters', () => {
    expect(baseForRemote('my remote')).toBe('/api/remotes/my%20remote/1.0');
  });
});

// ── setActiveRemote / getActiveRemote ─────────────────────────────────────────

describe('setActiveRemote / getActiveRemote', () => {
  beforeEach(() => {
    setActiveRemote('local');
  });

  it('defaults to local', () => {
    expect(getActiveRemote()).toBe('local');
  });

  it('stores a named remote', () => {
    setActiveRemote('prod');
    expect(getActiveRemote()).toBe('prod');
  });

  it('falls back to local for empty string', () => {
    setActiveRemote('');
    expect(getActiveRemote()).toBe('local');
  });
});
