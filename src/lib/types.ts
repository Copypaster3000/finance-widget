export type AssetType = 'stock' | 'crypto';
export type RefreshMode = 'manual' | '1h' | '15m' | '15s';
export type Accent = 'amber' | 'cyan' | 'mono';
export type WindowMode = 'normal' | 'alwaysOnTop';
export type StockSession = 'regular' | 'extended';
export type HistoryRange = '1h' | '1d' | '1w' | '1m' | 'all';
export type HistoryStartMode = 'auto' | 'manual';
export type ProviderKind = 'mock' | 'yahoo';
export type PriceSource = 'manual_unit' | 'manual_total' | 'historical_close' | 'previous_trading_close' | 'current_quote' | 'legacy_unknown';

export interface Holding {
  id: string;
  symbol: string;
  type: AssetType;
  quantity: number;
}

export interface LedgerAsset {
  id: string;
  symbol: string;
  type: AssetType;
  createdAt: string;
}

interface LedgerEventBase {
  id: string;
  date: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

export interface BuyEvent extends LedgerEventBase {
  eventType: 'buy';
  assetId: string;
  quantity: string;
  unitPrice?: string;
  fees: string;
  totalAmount?: string;
  priceSource: PriceSource;
  affectsCashDebt: boolean;
}

export interface SellEvent extends LedgerEventBase {
  eventType: 'sell';
  assetId: string;
  quantity: string;
  unitPrice: string;
  fees: string;
  totalAmount: string;
  priceSource: PriceSource;
  affectsCashDebt: boolean;
}

export interface CashOpeningEvent extends LedgerEventBase {
  eventType: 'cash_opening';
  amount: string;
}

export interface CashDepositEvent extends LedgerEventBase {
  eventType: 'cash_deposit';
  amount: string;
}

export interface CashWithdrawalEvent extends LedgerEventBase {
  eventType: 'cash_withdrawal';
  amount: string;
}

export interface DebtOpeningEvent extends LedgerEventBase {
  eventType: 'debt_opening';
  amount: string;
}

export interface DebtAdjustmentEvent extends LedgerEventBase {
  eventType: 'debt_adjustment';
  amount: string;
}

export interface CashAdjustmentEvent extends LedgerEventBase {
  eventType: 'cash_adjustment';
  amount: string;
}

export interface DebtPaymentEvent extends LedgerEventBase {
  eventType: 'debt_payment';
  amount: string;
  source: 'external' | 'cash';
}

export type LedgerEvent = BuyEvent | SellEvent | CashOpeningEvent | CashDepositEvent | CashWithdrawalEvent | CashAdjustmentEvent | DebtOpeningEvent | DebtAdjustmentEvent | DebtPaymentEvent;

export interface PortfolioLedger {
  schemaVersion: 2;
  assets: LedgerAsset[];
  events: LedgerEvent[];
}

export interface LedgerLotState {
  sourceEventId: string;
  acquiredDate: string;
  quantity: string;
  costBasis?: number;
}

export interface LedgerPositionState {
  asset: LedgerAsset;
  quantity: number;
  quantityDecimal: string;
  remainingCostBasis?: number;
  averageCost?: number;
  realizedGain?: number;
  lots: LedgerLotState[];
}

export interface LedgerAccountState {
  asOfDate?: string;
  cash: number;
  debt: number;
  positions: LedgerPositionState[];
}

export interface LedgerValidationIssue {
  eventId?: string;
  date?: string;
  message: string;
}

export type AccountActivityReason = 'opening' | 'manual_adjustment' | 'buy_funding' | 'sale_proceeds' | 'deposit_allocation' | 'withdrawal_funding' | 'debt_payment';

export interface AccountActivity {
  id: string;
  account: 'cash' | 'debt';
  reason: AccountActivityReason;
  sourceEventId: string;
  sourceEventType: LedgerEvent['eventType'];
  sourceView: 'asset' | 'cash' | 'debt';
  assetId?: string;
  date: string;
  sequence: number;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface LedgerReplayResult {
  state: LedgerAccountState;
  issues: LedgerValidationIssue[];
  activities: AccountActivity[];
}

export interface LedgerEventPreview {
  cashDelta: number;
  debtDelta: number;
  positionDelta: number;
  resultingCash: number;
  resultingDebt: number;
}

export interface LedgerEventPreviewResult {
  preview?: LedgerEventPreview;
  issues: LedgerValidationIssue[];
}

export interface LedgerMutationError {
  message: string;
  blockingEventIds: string[];
}

export interface TransactionPriceResolution {
  unitPrice: string;
  source: Extract<PriceSource, 'historical_close' | 'previous_trading_close' | 'current_quote'>;
  priceDate: string;
  requiresConfirmation: boolean;
}

export interface Quote {
  symbol: string;
  assetType: AssetType;
  price: number;
  currency: string;
  previousClose?: number;
  change?: number;
  changePercent?: number;
  timestamp: number;
  provider: string;
  status: 'live' | 'delayed' | 'cached' | 'mock';
}

export type FeedState = 'idle' | 'updating' | 'live' | 'delayed' | 'cached' | 'demo' | 'market_closed' | 'partial' | 'offline' | 'unavailable';

export interface PriceSourceTransition {
  from: string;
  to: string;
  delta: number;
  deltaPercent: number;
  detectedAt: number;
}

export interface FeedStatus {
  state: FeedState;
  provider?: string;
  lastCheckedAt: number;
  lastQuoteReceivedAt: number;
  detail?: string;
  transition?: PriceSourceTransition;
}

export interface HistoryWarning {
  symbols: string[];
  detail: string;
}

export interface AppearanceSettings {
  opacity: number;
  scale: number;
  accent: Accent;
  showHistory: boolean;
  showQuantity: boolean;
  showPrice: boolean;
  showDailyChange: boolean;
  showCash: boolean;
  showDebt: boolean;
  historyRange: HistoryRange;
}

export interface AppConfig {
  schemaVersion: 10;
  refreshMode: RefreshMode;
  appearance: AppearanceSettings;
  windowMode: WindowMode;
  launchAtStartup: boolean;
  showInTaskbar: boolean;
  stockSession: StockSession;
  historyStartDate: string;
  historyStartMode: HistoryStartMode;
}

export interface HistoricalPricePoint {
  date: string;
  price: number;
}

export interface HistoricalSeries {
  symbol: string;
  assetType: AssetType;
  points: HistoricalPricePoint[];
}

export interface HistoricalResult {
  series: HistoricalSeries[];
  errors: string[];
}

export interface HourlyPricePoint {
  timestamp: string;
  price: number;
}

export interface HourlySeries {
  symbol: string;
  assetType: AssetType;
  points: HourlyPricePoint[];
}

export interface HourlyResult {
  series: HourlySeries[];
  errors: string[];
}

export interface HistoricalCacheEntry extends HistoricalSeries {
  provider: ProviderKind;
  coveredStart: string;
  coveredEnd: string;
}

export type HistoricalCache = Record<string, HistoricalCacheEntry>;

export interface PortfolioHistoryPoint {
  date: string;
  value: number;
}

export interface PortfolioDayChange {
  baselineAt: string;
  baselineValue: number;
  value: number;
  percent: number;
}

export interface PortfolioHourlyCache {
  schemaVersion: 2;
  coveredThrough: string;
  points: PortfolioHistoryPoint[];
  recentPoints: PortfolioHistoryPoint[];
  assetPrices: Record<string, HourlyPricePoint>;
}

export interface LedgerPriceCacheEntry {
  assetId: string;
  symbol: string;
  assetType: AssetType;
  coveredThrough: string;
  points: HourlyPricePoint[];
}

export interface LedgerPriceCache {
  schemaVersion: 1;
  entries: Record<string, LedgerPriceCacheEntry>;
}

export interface Position {
  id: string;
  symbol: string;
  type: AssetType | 'cash' | 'debt';
  quantity: number;
  quote?: Quote;
  value: number;
  allocation: number;
  dailyChangeValue?: number;
}

export interface PortfolioSummary {
  positions: Position[];
  totalValue: number;
  grossAssets: number;
  cash: number;
  debt: number;
  dailyChangeValue?: number;
  dailyChangePercent?: number;
  investmentPositionCount: number;
}

export interface QuoteResult {
  quotes: Quote[];
  errors: string[];
}

export interface PriceProvider {
  readonly id: string;
  readonly name: string;
  getQuotes(holdings: Holding[]): Promise<QuoteResult>;
  getHistoricalPrices(holdings: Holding[], startDate: string, endDate: string): Promise<HistoricalResult>;
  getHourlyPrices?(holdings: Holding[], startTime: string, endTime: string): Promise<HourlyResult>;
  supportsStreaming(): boolean;
  subscribe?(holdings: Holding[], onQuote: (quote: Quote) => void): Promise<() => void>;
}
