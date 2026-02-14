import { describe, it, expect } from 'vitest';
import { generateMarkPatch, generateRestorePatch, parseCaptureTitle } from '../mark-patcher.js';

describe('generateMarkPatch', () => {
  it('generates valid JavaScript IIFE', () => {
    const code = generateMarkPatch('start-mark', 'end-mark', 50);
    expect(code).toMatch(/^\(function\(\)/);
    expect(code).toMatch(/\}\)\(\);$/);
  });

  it('includes the start and end mark names', () => {
    const code = generateMarkPatch('my-start', 'my-end', 50);
    expect(code).toContain("'my-start'");
    expect(code).toContain("'my-end'");
  });

  it('includes the maxCaptures limit', () => {
    const code = generateMarkPatch('s', 'e', 42);
    expect(code).toContain('42');
  });

  it('patches performance.mark and stores original', () => {
    const code = generateMarkPatch('s', 'e', 50);
    expect(code).toContain('performance.__originalMark');
    expect(code).toContain('console.profile');
    expect(code).toContain('console.profileEnd');
  });

  it('includes depth tracking for re-entrancy', () => {
    const code = generateMarkPatch('s', 'e', 50);
    expect(code).toContain('depth');
  });

  it('escapes single quotes in mark names', () => {
    const code = generateMarkPatch("mark's-start", "mark's-end", 50);
    expect(code).toContain("mark\\'s-start");
    expect(code).toContain("mark\\'s-end");
  });
});

describe('generateRestorePatch', () => {
  it('generates restore code referencing __originalMark', () => {
    const code = generateRestorePatch();
    expect(code).toContain('performance.__originalMark');
    expect(code).toContain('performance.mark');
  });
});

describe('parseCaptureTitle', () => {
  it('parses simple capture title', () => {
    const result = parseCaptureTitle('capture-3');
    expect(result.captureIndex).toBe(3);
    expect(result.overlapCount).toBe(1);
  });

  it('parses capture title with overlap', () => {
    const result = parseCaptureTitle('capture-5:overlap-2');
    expect(result.captureIndex).toBe(5);
    expect(result.overlapCount).toBe(2);
  });

  it('handles unknown format gracefully', () => {
    const result = parseCaptureTitle('unknown');
    expect(result.captureIndex).toBe(0);
    expect(result.overlapCount).toBe(1);
  });
});
