import { describe, expect, it } from 'vitest';
import { rollingGlyphs } from './rolling';

describe('rollingGlyphs', () => {
  it('marks only changed digits for animation', () => {
    const glyphs = rollingGlyphs('$1,239.56', '$1,234.56', 1);
    const rolling = glyphs.filter((glyph) => glyph.rolling);

    expect(rolling).toHaveLength(1);
    expect(rolling[0]).toMatchObject({ previous: '4', current: '9' });
    expect(rolling[0]?.wheel).toEqual(['4', '5', '6', '7', '8', '9']);
    expect(rolling[0]?.durationMs).toBe(1000);
    expect(glyphs.find((glyph) => glyph.current === ',')?.rolling).toBe(false);
  });

  it('aligns formatted values from the right when their length changes', () => {
    const glyphs = rollingGlyphs('$1,000.09', '$999.99', 2);
    const rolling = glyphs.filter((glyph) => glyph.rolling);

    expect(rolling.map(({ previous, current }) => `${previous}>${current}`)).toEqual(['9>0', '9>0', '9>0', '9>0']);
  });

  it('does not animate a newly introduced digit without an old digit', () => {
    const glyphs = rollingGlyphs('$10.00', '$9.00', 3);

    expect(glyphs[1]).toMatchObject({ current: '1', previous: '', rolling: false });
  });

  it('reverses through intermediary digits and staggers wheels right to left', () => {
    const glyphs = rollingGlyphs('$42.10', '$43.25', 4);
    const rolling = glyphs.filter((glyph) => glyph.rolling);

    expect(rolling.at(-1)?.wheel).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(rolling.at(-1)?.delayMs).toBe(0);
    expect(rolling[0]?.delayMs).toBeGreaterThan(rolling.at(-1)?.delayMs ?? 0);
    expect(Math.max(...rolling.map((glyph) => glyph.delayMs + glyph.durationMs))).toBeCloseTo(1000);
  });
});
