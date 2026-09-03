// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssetDetailPanel from './AssetDetailPanel.svelte';
import type { LedgerAsset, LedgerEvent, LedgerPositionState } from '../lib/types';

const createdAt = '2026-08-17T00:00:00.000Z';
const asset: LedgerAsset = { id: 'test-asset', symbol: 'TEST', type: 'stock', createdAt };
const position: LedgerPositionState = { asset, quantity: 0, quantityDecimal: '0', remainingCostBasis: 0, averageCost: undefined, realizedGain: 0, lots: [] };

function props(overrides: Record<string, unknown> = {}) {
  return {
    asset, position, quote: undefined, events: [], onBack: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined), onDelete: vi.fn().mockResolvedValue(undefined),
    onOpenEvent: vi.fn(), resolvePrice: vi.fn(), previewEvent: vi.fn().mockReturnValue({ issues: [] }),
    ...overrides
  };
}

afterEach(cleanup);

describe('per-trade Cash and Debt control', () => {
  it('saves a new Buy with its independent account-impact choice disabled', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(AssetDetailPanel, { props: props({ onSave }) });
    await fireEvent.click(screen.getByRole('button', { name: '+ BUY' }));
    await fireEvent.input(screen.getByLabelText('DATE'), { target: { value: '2026-08-17' } });
    await fireEvent.input(screen.getByLabelText('QUANTITY'), { target: { value: '2.5' } });
    await fireEvent.input(screen.getByLabelText('PRICE / UNIT'), { target: { value: '40' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: /USE TRACKED CASH \/ DEBT/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'ADD BUY' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ eventType: 'buy', assetId: 'test-asset', date: '2026-08-17', quantity: '2.5', totalAmount: '100', affectsCashDebt: false });
    expect(screen.getByText('POSITION')).toBeTruthy();
  });

  it('restores the saved account-impact choice while editing', async () => {
    const externalBuy = { id: 'buy', eventType: 'buy', assetId: asset.id, date: '2026-08-17', sequence: 1, quantity: '2.5', unitPrice: '40', fees: '0', totalAmount: '100', priceSource: 'manual_total', affectsCashDebt: false, createdAt, updatedAt: createdAt } as LedgerEvent;
    render(AssetDetailPanel, { props: props({ events: [externalBuy], initialEventId: externalBuy.id }) });
    expect((await screen.findByRole('checkbox', { name: /USE TRACKED CASH \/ DEBT/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('exposes only Buy and Sell actions on position detail', () => {
    render(AssetDetailPanel, { props: props() });
    expect(screen.getByRole('button', { name: '+ BUY' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ SELL' })).toBeTruthy();
    expect(screen.queryByText(/OPENING POSITION/)).toBeNull();
  });

  it('keeps a blocked trade edit visible and links the dependent ledger event', async () => {
    const buy = { id: 'buy', eventType: 'buy', assetId: asset.id, date: '2026-08-17', sequence: 1, quantity: '2.5', unitPrice: '40', fees: '0', totalAmount: '100', priceSource: 'manual_total', affectsCashDebt: true, createdAt, updatedAt: createdAt } as LedgerEvent;
    const adjustment = { id: 'adjustment', eventType: 'debt_adjustment', date: '2026-08-29', sequence: 2, amount: '-100', createdAt, updatedAt: createdAt } as LedgerEvent;
    const onOpenEvent = vi.fn();
    render(AssetDetailPanel, { props: props({ events: [buy, adjustment], initialEventId: buy.id, onSave: vi.fn().mockResolvedValue({ message: 'Debt adjustment would make Debt negative', blockingEventIds: [adjustment.id] }), onOpenEvent }) });
    await fireEvent.click(await screen.findByRole('checkbox', { name: /USE TRACKED CASH \/ DEBT/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'SAVE TRANSACTION' }));
    expect(await screen.findByText('SAVE NOT APPLIED')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'REVIEW' }));
    expect(onOpenEvent).toHaveBeenCalledWith(adjustment.id);
  });

  it('keeps a blocked deletion error inside its confirmation and links the dependent event', async () => {
    const buy = { id: 'buy', eventType: 'buy', assetId: asset.id, date: '2026-08-17', sequence: 1, quantity: '2.5', unitPrice: '40', fees: '0', totalAmount: '100', priceSource: 'manual_total', affectsCashDebt: true, createdAt, updatedAt: createdAt } as LedgerEvent;
    const adjustment = { id: 'adjustment', eventType: 'debt_adjustment', date: '2026-08-29', sequence: 2, amount: '-100', createdAt, updatedAt: createdAt } as LedgerEvent;
    const onOpenEvent = vi.fn();
    render(AssetDetailPanel, { props: props({ position: { ...position, quantity: 2.5, quantityDecimal: '2.5' }, events: [buy, adjustment], initialEventId: buy.id, onDelete: vi.fn().mockResolvedValue({ message: 'Debt adjustment would make Debt negative', blockingEventIds: [adjustment.id] }), onOpenEvent }) });
    await fireEvent.click(screen.getByRole('button', { name: 'DELETE TRANSACTION' }));
    await fireEvent.click(screen.getByRole('button', { name: 'DELETE' }));
    expect(await screen.findByText('DELETE BLOCKED')).toBeTruthy();
    expect(screen.getByText(/Debt adjustment would make Debt negative/i)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'REVIEW' }));
    expect(onOpenEvent).toHaveBeenCalledWith(adjustment.id);
  });

  it('returns to position detail after a successful confirmed deletion', async () => {
    const buy = { id: 'buy', eventType: 'buy', assetId: asset.id, date: '2026-08-17', sequence: 1, quantity: '2.5', unitPrice: '40', fees: '0', totalAmount: '100', priceSource: 'manual_total', affectsCashDebt: true, createdAt, updatedAt: createdAt } as LedgerEvent;
    render(AssetDetailPanel, { props: props({ position: { ...position, quantity: 2.5, quantityDecimal: '2.5' }, events: [buy], initialEventId: buy.id }) });
    await fireEvent.click(screen.getByRole('button', { name: 'DELETE TRANSACTION' }));
    await fireEvent.click(screen.getByRole('button', { name: 'DELETE' }));
    expect(await screen.findByText('POSITION')).toBeTruthy();
    expect(screen.queryByText(/DELETE BUY ON/)).toBeNull();
  });
});
