import { describe, expect, it } from 'vitest';
import { buildTradeEvent, hasDecimalInput } from './transactions';

describe('trade normalization', () => {
  it('includes fees in buy Total Paid', () => {
    const result = buildTradeEvent({ side: 'buy', assetId: 'a', date: '2026-08-20', sequence: 1, quantity: '20', mode: 'unit', unitPrice: '332.10', fees: '2' }, '2026-08-29');
    expect(result.event?.totalAmount).toBe('6644');
    expect(result.event?.fees).toBe('2');
  });

  it('treats manual Total Paid as authoritative and derives effective unit cost', () => {
    const result = buildTradeEvent({ side: 'buy', assetId: 'a', date: '2026-08-20', sequence: 1, quantity: '20', mode: 'total', totalAmount: '6644' }, '2026-08-29');
    expect(result.event?.unitPrice).toBe('332.2');
    expect(result.event?.priceSource).toBe('manual_total');
    expect(result.event?.affectsCashDebt).toBe(true);
  });

  it('deducts fees from sell proceeds', () => {
    const result = buildTradeEvent({ side: 'sell', assetId: 'a', date: '2026-08-20', sequence: 1, quantity: '10', mode: 'unit', unitPrice: '375', fees: '1' }, '2026-08-29');
    expect(result.event?.totalAmount).toBe('3749');
  });

  it('rejects excessive precision and future dates', () => {
    expect(buildTradeEvent({ side: 'buy', assetId: 'a', date: '2026-08-20', sequence: 1, quantity: '0.000000001', mode: 'total', totalAmount: '1' }, '2026-08-29').error).toContain('Quantity');
    expect(buildTradeEvent({ side: 'buy', assetId: 'a', date: '2026-08-30', sequence: 1, quantity: '1', mode: 'total', totalAmount: '1' }, '2026-08-29').error).toContain('future');
  });

  it('accepts numeric values emitted by number inputs', () => {
    const trade = buildTradeEvent({ side: 'buy', assetId: 'a', date: '2026-08-20', sequence: 1, quantity: 1.25, mode: 'total', totalAmount: 250.75 }, '2026-08-29');
    expect(trade.event?.quantity).toBe('1.25');
    expect(trade.event?.totalAmount).toBe('250.75');
    expect(hasDecimalInput(0)).toBe(true);
  });

  it('stores Cash and Debt impact independently on each trade', () => {
    const result = buildTradeEvent({ side: 'buy', assetId: 'test-asset', date: '2026-08-17', sequence: 1, quantity: '2.5', mode: 'unit', unitPrice: '40', affectsCashDebt: false }, '2026-08-29');
    expect(result.event).toMatchObject({
      eventType: 'buy',
      quantity: '2.5',
      totalAmount: '100',
      priceSource: 'manual_unit',
      affectsCashDebt: false
    });
  });
});
