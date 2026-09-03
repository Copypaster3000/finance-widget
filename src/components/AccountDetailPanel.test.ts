// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountDetailPanel from './AccountDetailPanel.svelte';
import type { AccountActivity, LedgerAsset, LedgerEvent, LedgerEventPreviewResult } from '../lib/types';

const createdAt = '2026-08-17T00:00:00.000Z';
const asset: LedgerAsset = { id: 'btc', symbol: 'BTC', type: 'crypto', createdAt };
const preview: LedgerEventPreviewResult = { preview: { cashDelta: 0, debtDelta: -100, positionDelta: 0, resultingCash: 500, resultingDebt: 900 }, issues: [] };

afterEach(cleanup);

function props(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'debt' as const,
    balance: 1000,
    events: [] as LedgerEvent[],
    activities: [] as AccountActivity[],
    assets: [asset],
    onBack: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onOpenSource: vi.fn(),
    onOpenEvent: vi.fn(),
    previewEvent: vi.fn().mockReturnValue(preview),
    ...overrides
  };
}

describe('account ledger controls', () => {
  it('records a Debt payment with an explicit Cash source', async () => {
    const input = props();
    render(AccountDetailPanel, { props: input });
    await fireEvent.click(screen.getByRole('button', { name: '− PAY DOWN' }));
    await fireEvent.input(screen.getByLabelText('AMOUNT'), { target: { value: '100' } });
    await fireEvent.click(screen.getByRole('button', { name: 'FROM CASH' }));
    await fireEvent.click(screen.getByRole('button', { name: 'PAY DOWN DEBT' }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledTimes(1));
    expect(input.onSave.mock.calls[0][0]).toMatchObject({ eventType: 'debt_payment', amount: '100', source: 'cash' });
  });

  it('turns a target Debt balance into a non-destructive adjustment', async () => {
    const input = props();
    render(AccountDetailPanel, { props: input });
    await fireEvent.click(screen.getByRole('button', { name: 'SET BALANCE' }));
    await fireEvent.input(screen.getByLabelText('TARGET BALANCE'), { target: { value: '400' } });
    await fireEvent.click(screen.getByRole('button', { name: 'SET DEBT BALANCE' }));
    await waitFor(() => expect(input.onSave).toHaveBeenCalledTimes(1));
    expect(input.onSave.mock.calls[0][0]).toMatchObject({ eventType: 'debt_adjustment', amount: '-600' });
  });

  it('routes a derived Buy funding row to its canonical asset transaction', async () => {
    const activity: AccountActivity = {
      id: 'buy:debt', account: 'debt', reason: 'buy_funding', sourceEventId: 'buy', sourceEventType: 'buy', sourceView: 'asset', assetId: asset.id,
      date: '2026-08-17', sequence: 1, delta: 1000, balanceBefore: 0, balanceAfter: 1000
    };
    const input = props({ activities: [activity] });
    render(AccountDetailPanel, { props: input });
    await fireEvent.click(screen.getByRole('button', { name: /BUY \/ BTC/ }));
    expect(input.onOpenSource).toHaveBeenCalledWith(activity);
  });
});
