import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { MOCK_QUOTES } from './defaults';
import { datesBetween } from './history';
import type { HistoricalPricePoint, HistoricalResult, HistoricalSeries, Holding, HourlyPricePoint, HourlyResult, HourlySeries, PriceProvider, Quote, QuoteResult } from './types';

function uniqueHoldings(holdings: Holding[]): Holding[] {
  return [...new Map(holdings.map((holding) => [`${holding.type}:${holding.symbol.toUpperCase()}`, holding])).values()];
}

export class MockPriceProvider implements PriceProvider {
  readonly id = 'mock';
  readonly name = 'Demo feed';

  async getQuotes(holdings: Holding[]): Promise<QuoteResult> {
    const now = Date.now();
    const quoteMap = new Map(MOCK_QUOTES.map((quote) => [`${quote.assetType}:${quote.symbol}`, quote]));
    const quotes = uniqueHoldings(holdings).map((holding, index) => {
      const existing = quoteMap.get(`${holding.type}:${holding.symbol.toUpperCase()}`);
      if (existing) return { ...existing, timestamp: now };
      return { symbol: holding.symbol.toUpperCase(), assetType: holding.type, price: 100 + index * 27.42, currency: 'USD', timestamp: now, provider: this.name, status: 'mock' as const };
    });
    await new Promise((resolve) => setTimeout(resolve, 380));
    return { quotes, errors: [] };
  }

  async getHistoricalPrices(holdings: Holding[], startDate: string, endDate: string): Promise<HistoricalResult> {
    const quoteMap = new Map(MOCK_QUOTES.map((quote) => [`${quote.assetType}:${quote.symbol}`, quote.price]));
    const series = uniqueHoldings(holdings).map((holding) => {
      const symbol = holding.symbol.toUpperCase();
      const base = quoteMap.get(`${holding.type}:${symbol}`) ?? 100;
      const seed = [...symbol].reduce((total, character) => total + character.charCodeAt(0), 0);
      const dates = datesBetween(startDate, endDate).filter((date) => holding.type === 'crypto' || ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()));
      const points = dates.map((date, index) => {
        const distance = Math.max(1, dates.length - index);
        const drift = 1 - distance * 0.0045;
        const wave = Math.sin((index + seed) * 0.72) * 0.016;
        return { date, price: Math.max(0.01, base * (drift + wave)) };
      });
      return { symbol, assetType: holding.type, points };
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
    return { series, errors: [] };
  }

  async getHourlyPrices(holdings: Holding[], startTime: string, endTime: string): Promise<HourlyResult> {
    const start = Date.parse(startTime);
    const end = Date.parse(endTime);
    const quoteMap = new Map(MOCK_QUOTES.map((quote) => [`${quote.assetType}:${quote.symbol}`, quote.price]));
    const series = uniqueHoldings(holdings).map((holding) => {
      const symbol = holding.symbol.toUpperCase();
      const base = quoteMap.get(`${holding.type}:${symbol}`) ?? 100;
      const points: HourlyPricePoint[] = [];
      for (let timestamp = start, index = 0; timestamp <= end; timestamp += 3_600_000, index += 1) {
        const hour = new Date(timestamp).getUTCHours();
        const day = new Date(timestamp).getUTCDay();
        const marketOpen = holding.type === 'crypto' || (![0, 6].includes(day) && hour >= 14 && hour <= 20);
        if (marketOpen) points.push({ timestamp: new Date(timestamp).toISOString(), price: Math.max(0.01, base * (0.96 + index * 0.0004 + Math.sin(index * 0.3) * 0.006)) });
      }
      return { symbol, assetType: holding.type, points };
    });
    return { series, errors: [] };
  }

  supportsStreaming(): boolean { return false; }
}

type YahooChartResult = {
  meta?: Record<string, string | number | null | undefined>;
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

type YahooChartPayload = {
  chart?: {
    error?: { description?: string } | null;
    result?: YahooChartResult[] | null;
  };
};

type YahooSessionQuote = {
  symbol?: string;
  currency?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  preMarketPrice?: number;
  preMarketTime?: number;
  postMarketPrice?: number;
  postMarketTime?: number;
  overnightMarketPrice?: number;
  overnightMarketTime?: number;
};

type YahooSessionPayload = {
  quoteResponse?: {
    error?: { description?: string } | null;
    result?: YahooSessionQuote[] | null;
  };
};

function yahooResult(payload: YahooChartPayload, holding: Holding): YahooChartResult {
  const error = payload.chart?.error?.description;
  if (error) throw new Error(`${holding.symbol}: Yahoo ${error}`);
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`${holding.symbol}: Yahoo quote unavailable`);
  return result;
}

export function normalizeYahooQuote(payload: YahooChartPayload, holding: Holding, includeExtendedHours = false): Quote {
  const result = yahooResult(payload, holding);
  const meta = result.meta ?? {};
  const regularPrice = Number(meta.regularMarketPrice);
  if (!Number.isFinite(regularPrice) || regularPrice <= 0) throw new Error(`${holding.symbol}: Yahoo market price unavailable`);
  const regularTimestamp = Number(meta.regularMarketTime);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const intradayCloses = result.indicators?.quote?.[0]?.close ?? [];
  const latestBar = timestamps.reduce<{ price: number; timestamp: number } | undefined>((latest, timestamp, index) => {
    const price = Number(intradayCloses[index]);
    return Number.isFinite(timestamp) && timestamp > 0 && Number.isFinite(price) && price > 0 && (!latest || timestamp > latest.timestamp)
      ? { price, timestamp }
      : latest;
  }, undefined);
  const useExtendedBar = includeExtendedHours && holding.type === 'stock' && latestBar
    && (!Number.isFinite(regularTimestamp) || latestBar.timestamp > regularTimestamp);
  const price = useExtendedBar ? latestBar.price : regularPrice;
  const dailyCloses = (result.indicators?.quote?.[0]?.close ?? [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const derivedPreviousClose = !includeExtendedHours && dailyCloses.length >= 2 ? dailyCloses.at(-2) : undefined;
  const regularPreviousClose = Number(meta.regularMarketPreviousClose);
  const legacyPreviousClose = Number(meta.previousClose);
  const previousClose = Number.isFinite(regularPreviousClose) && regularPreviousClose > 0
    ? regularPreviousClose
    : (derivedPreviousClose ?? legacyPreviousClose);
  const timestamp = useExtendedBar ? latestBar.timestamp : regularTimestamp;
  const hasPreviousClose = Number.isFinite(previousClose) && previousClose > 0;
  const change = hasPreviousClose ? price - previousClose : undefined;
  return {
    symbol: holding.symbol.toUpperCase(),
    assetType: holding.type,
    price,
    currency: String(meta.currency ?? 'USD'),
    previousClose: hasPreviousClose ? previousClose : undefined,
    change,
    changePercent: change !== undefined ? (change / previousClose) * 100 : undefined,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : Date.now(),
    provider: 'Yahoo Finance',
    status: 'delayed'
  };
}

export function applyYahooSessionQuote(quote: Quote, sessionQuote: YahooSessionQuote | undefined, holding: Holding): Quote {
  if (!sessionQuote || holding.type !== 'stock') return quote;
  const candidates = [
    [sessionQuote.regularMarketPrice, sessionQuote.regularMarketTime],
    [sessionQuote.preMarketPrice, sessionQuote.preMarketTime],
    [sessionQuote.postMarketPrice, sessionQuote.postMarketTime],
    [sessionQuote.overnightMarketPrice, sessionQuote.overnightMarketTime]
  ].flatMap(([rawPrice, rawTimestamp]) => {
    const price = Number(rawPrice);
    const timestamp = Number(rawTimestamp);
    return Number.isFinite(price) && price > 0 && Number.isFinite(timestamp) && timestamp > 0
      ? [{ price, timestamp: timestamp * 1000 }]
      : [];
  });
  const newest = candidates.reduce<{ price: number; timestamp: number } | undefined>((latest, candidate) => (
    !latest || candidate.timestamp > latest.timestamp ? candidate : latest
  ), undefined);
  if (!newest || newest.timestamp <= quote.timestamp) return quote;
  const previousClose = quote.previousClose;
  const hasPreviousClose = previousClose !== undefined;
  const change = hasPreviousClose ? newest.price - previousClose : undefined;
  return {
    ...quote,
    price: newest.price,
    currency: sessionQuote.currency ?? quote.currency,
    change,
    changePercent: change !== undefined && hasPreviousClose ? (change / previousClose) * 100 : undefined,
    timestamp: newest.timestamp
  };
}

export function normalizeYahooHistory(payload: YahooChartPayload, holding: Holding, startDate: string, endDate: string): HistoricalPricePoint[] {
  const result = yahooResult(payload, holding);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error(`${holding.symbol}: Yahoo history unavailable`);
  const points = timestamps.flatMap((timestamp, index) => {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const price = Number(closes[index]);
    return date >= startDate && date <= endDate && Number.isFinite(price) && price > 0 ? [{ date, price }] : [];
  });
  if (timestamps.length && !points.length) throw new Error(`${holding.symbol}: malformed Yahoo history`);
  return [...new Map(points.map((point) => [point.date, point])).values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeYahooHourly(payload: YahooChartPayload, holding: Holding, startTime: string, endTime: string): HourlyPricePoint[] {
  const result = yahooResult(payload, holding);
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) throw new Error(`${holding.symbol}: Yahoo hourly history unavailable`);
  const points = timestamps.flatMap((timestamp, index) => {
    const date = new Date(timestamp * 1000);
    date.setUTCMinutes(0, 0, 0);
    const iso = date.toISOString();
    const price = Number(closes[index]);
    return iso >= startTime && iso <= endTime && Number.isFinite(price) && price > 0 ? [{ timestamp: iso, price }] : [];
  });
  if (timestamps.length && !points.length) throw new Error(`${holding.symbol}: malformed Yahoo hourly history`);
  return [...new Map(points.map((point) => [point.timestamp, point])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function unixDate(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

export class YahooFinanceProvider implements PriceProvider {
  readonly id = 'yahoo';
  readonly name = 'Yahoo Finance';

  constructor(private readonly includeExtendedHours = false) {}

  private url(holding: Holding, params: URLSearchParams): string {
    return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(holding))}?${params.toString()}`;
  }

  private async sessionQuotes(holdings: Holding[]): Promise<Map<string, YahooSessionQuote>> {
    if (!holdings.length) return new Map();
    const response = await invoke<string>('fetch_yahoo_session_quotes', {
      symbols: holdings.map(yahooSymbol)
    });
    const payload = JSON.parse(response) as YahooSessionPayload;
    const error = payload.quoteResponse?.error?.description;
    if (error) throw new Error(`Yahoo overnight ${error}`);
    return new Map((payload.quoteResponse?.result ?? []).flatMap((quote) => (
      quote.symbol ? [[quote.symbol.toUpperCase(), quote] as const] : []
    )));
  }

  async getQuotes(holdings: Holding[]): Promise<QuoteResult> {
    const unique = uniqueHoldings(holdings);
    const sessionPromise = this.includeExtendedHours
      ? this.sessionQuotes(unique.filter((holding) => holding.type === 'stock')).catch(() => undefined)
      : Promise.resolve(undefined);
    const results = await Promise.allSettled(unique.map(async (holding) => {
      const useIntraday = this.includeExtendedHours && holding.type === 'stock';
      const params = yahooQuoteParams(holding, this.includeExtendedHours);
      const response = await fetch(this.url(holding, params), { method: 'GET' });
      if (!response.ok) throw new Error(`${holding.symbol}: Yahoo HTTP ${response.status}`);
      return normalizeYahooQuote(await response.json() as YahooChartPayload, holding, useIntraday);
    }));
    const sessionQuotes = await sessionPromise;
    const quotes: Quote[] = [];
    const errors: string[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === 'fulfilled') quotes.push(applyYahooSessionQuote(
        result.value, sessionQuotes?.get(yahooSymbol(unique[index])), unique[index]
      ));
      else errors.push(result.reason instanceof Error ? result.reason.message : 'Unknown Yahoo provider error');
    }
    return { quotes, errors };
  }

  async getHistoricalPrices(holdings: Holding[], startDate: string, endDate: string): Promise<HistoricalResult> {
    const results = await Promise.allSettled(uniqueHoldings(holdings).map(async (holding) => {
      const params = new URLSearchParams({
        period1: String(unixDate(startDate)),
        period2: String(unixDate(endDate) + 86_400),
        interval: '1d',
        events: 'history'
      });
      const response = await fetch(this.url(holding, params), { method: 'GET' });
      if (!response.ok) throw new Error(`${holding.symbol}: Yahoo history HTTP ${response.status}`);
      return {
        symbol: holding.symbol.toUpperCase(),
        assetType: holding.type,
        points: normalizeYahooHistory(await response.json() as YahooChartPayload, holding, startDate, endDate)
      } as HistoricalSeries;
    }));
    const series: HistoricalSeries[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') series.push(result.value);
      else errors.push(result.reason instanceof Error ? result.reason.message : 'Unknown Yahoo historical provider error');
    }
    return { series, errors };
  }

  async getHourlyPrices(holdings: Holding[], startTime: string, endTime: string): Promise<HourlyResult> {
    const results = await Promise.allSettled(uniqueHoldings(holdings).map(async (holding) => {
      const params = yahooHourlyParams(holding, startTime, endTime, this.includeExtendedHours);
      const response = await fetch(this.url(holding, params), { method: 'GET' });
      if (!response.ok) throw new Error(`${holding.symbol}: Yahoo hourly HTTP ${response.status}`);
      return {
        symbol: holding.symbol.toUpperCase(), assetType: holding.type,
        points: normalizeYahooHourly(await response.json() as YahooChartPayload, holding, startTime, endTime)
      } as HourlySeries;
    }));
    const series: HourlySeries[] = [];
    const errors: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') series.push(result.value);
      else errors.push(result.reason instanceof Error ? result.reason.message : 'Unknown Yahoo hourly provider error');
    }
    return { series, errors };
  }

  supportsStreaming(): boolean { return false; }
}

export function yahooSymbol(holding: Holding): string {
  return holding.type === 'crypto' ? `${holding.symbol.toUpperCase()}-USD` : holding.symbol.toUpperCase();
}

export function yahooQuoteParams(holding: Holding, includeExtendedHours: boolean): URLSearchParams {
  const useIntraday = includeExtendedHours && holding.type === 'stock';
  return new URLSearchParams({
    range: useIntraday ? '1d' : '5d',
    interval: useIntraday ? '1m' : '1d',
    includePrePost: String(useIntraday),
    events: 'history'
  });
}

export function yahooHourlyParams(holding: Holding, startTime: string, endTime: string, includeExtendedHours: boolean): URLSearchParams {
  return new URLSearchParams({
    period1: String(Math.floor(Date.parse(startTime) / 1000)),
    period2: String(Math.floor(Date.parse(endTime) / 1000) + 3_600),
    interval: '1h',
    includePrePost: String(includeExtendedHours && holding.type === 'stock'),
    events: 'history'
  });
}

export function createProvider(includeExtendedHours = false): PriceProvider { return new YahooFinanceProvider(includeExtendedHours); }
