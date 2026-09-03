// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsView from './SettingsView.svelte';
import { DEFAULT_CONFIG } from '../lib/defaults';

afterEach(cleanup);

describe('history start controls', () => {
  it('keeps Manual selected and applies the per-user date mode', async () => {
    const onApply = vi.fn();
    render(SettingsView, { props: { config: structuredClone(DEFAULT_CONFIG), autoHistoryStartDate: '2026-08-17', onApply, onBack: vi.fn() } });

    const manual = screen.getByRole('button', { name: 'MANUAL', pressed: false });
    await fireEvent.click(manual);
    expect(manual.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Pinned to this date, even before the first Buy.')).toBeTruthy();

    await fireEvent.input(screen.getByLabelText('START DATE'), { target: { value: '2026-08-10' } });
    await fireEvent.click(screen.getByRole('button', { name: /APPLY CONFIG/ }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ historyStartMode: 'manual', historyStartDate: '2026-08-10' }));
  });
});
