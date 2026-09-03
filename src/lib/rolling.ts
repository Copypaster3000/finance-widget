export type RollingGlyph = {
  key: string;
  current: string;
  previous: string;
  rolling: boolean;
  wheel: string[];
  delayMs: number;
  durationMs: number;
  startPercent: number;
  endPercent: number;
};

const isDigit = (character: string) => /^\d$/.test(character);

function numericValue(value: string): number {
  const normalized = value.replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function digitSequence(previous: string, current: string, direction: 1 | -1): string[] {
  const sequence = [previous];
  let digit = Number(previous);
  const target = Number(current);
  while (digit !== target) {
    digit = (digit + direction + 10) % 10;
    sequence.push(String(digit));
  }
  return sequence;
}

export function rollingGlyphs(next: string, prior: string, revision: number): RollingGlyph[] {
  const nextNumberStart = next.search(/\d/);
  const priorNumberStart = prior.search(/\d/);
  const numericOffset = nextNumberStart >= 0 && priorNumberStart >= 0
    ? (next.length - nextNumberStart) - (prior.length - priorNumberStart)
    : 0;

  const direction: 1 | -1 = numericValue(next) >= numericValue(prior) ? 1 : -1;
  const glyphs = [...next].map((current, index): RollingGlyph => {
    const priorIndex = nextNumberStart >= 0 && priorNumberStart >= 0 && index >= nextNumberStart
      ? priorNumberStart + index - nextNumberStart - numericOffset
      : index;
    const previous = index >= nextNumberStart && priorIndex < priorNumberStart ? '' : (prior[priorIndex] ?? '');
    const rolling = isDigit(current) && isDigit(previous) && current !== previous;
    const sequence = rolling ? digitSequence(previous, current, direction) : [current];
    const steps = sequence.length - 1;
    const wheel = direction === 1 ? sequence : [...sequence].reverse();
    return {
      key: `${revision}-${index}`,
      current,
      previous,
      rolling,
      wheel,
      delayMs: 0,
      durationMs: 0,
      startPercent: direction === 1 ? 0 : -steps * 100,
      endPercent: direction === 1 ? -steps * 100 : 0
    };
  });

  const totalSteps = glyphs.reduce((total, glyph) => total + Math.max(0, glyph.wheel.length - 1), 0);
  const millisecondsPerStep = totalSteps ? 1000 / totalSteps : 0;
  let elapsed = 0;
  for (const glyph of [...glyphs].reverse()) {
    if (!glyph.rolling) continue;
    const steps = glyph.wheel.length - 1;
    glyph.delayMs = elapsed;
    glyph.durationMs = steps * millisecondsPerStep;
    elapsed += glyph.durationMs;
  }

  return glyphs;
}
