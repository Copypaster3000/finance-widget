import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTradeEvent, effectiveUnitPrice } from './transactions';
import { datedBalanceDelta, replayLedger, sanitizeLedger, updateLedgerEvent } from './ledger';
import { MAX_MONEY, parseFixed, safeNumber } from './decimal';
import { calculateLedgerHistory, sanitizeLedgerPriceCache, syncLedgerPriceCache } from './ledgerHistory';
import { localCalendarStartTimestamp, localCalendarDate } from './calendar';
import { detectLedgerPriceSourceTransition, mergeIncomingQuotes, preferredStoredQuotes } from './feed';
import { quoteFreshness, quoteTradePrice, resolveCurrentTradePrice, validQuote } from './quotePolicy';
import { normalizeYahooQuote } from './providers';
import { calculateLedgerPortfolio } from './portfolio';
import { RefreshQueue, withTimeout } from './requests';
import { chartHistory, sanitizeHourlyCache } from './hourly';
import { cachedSeries } from './history';
import type { LedgerEvent, PortfolioLedger, Quote, PriceProvider } from './types';

const stamp='2020-01-01T00:00:00.000Z';
const asset={id:'synthetic',symbol:'TEST',type:'crypto' as const,createdAt:stamp};
const base={createdAt:stamp,updatedAt:stamp};
function ledger(events:LedgerEvent[]=[]):PortfolioLedger{return {schemaVersion:2,assets:[asset],events};}
function account(kind:'cash'|'debt',amount:string,date='2020-01-01',sequence=1):LedgerEvent{return {...base,id:`${kind}-${sequence}`,date,sequence,eventType:`${kind}_opening`,amount};}
function buy(id='buy',quantity='2',date='2020-01-01'):LedgerEvent{return buildTradeEvent({id,side:'buy',assetId:asset.id,date,sequence:1,quantity,mode:'unit',unitPrice:'5',fees:'0',affectsCashDebt:false},'2020-12-31',stamp).event!;}
const now=Date.parse('2020-02-03T18:00:00Z');
function quote(overrides:Partial<Quote>={}):Quote{return {symbol:'TEST',assetType:'crypto',currency:'USD',price:5,timestamp:now,provider:'test',status:'delayed',...overrides};}
afterEach(()=>vi.useRealTimers());

it('discards unsupported chart cache magnitudes without losing valid points',()=>{
  const cache=sanitizeHourlyCache({points:[{date:stamp,value:25},{date:'2020-01-02T00:00:00Z',value:MAX_MONEY+1}],assetPrices:{'crypto:TEST':{timestamp:stamp,price:1_000_001}}});
  expect(cache.points).toEqual([{date:stamp,value:25}]);
  expect(cache.assetPrices).toEqual({});
  expect(chartHistory(cache,Infinity,now)).toEqual(cache.points);
  expect(cachedSeries({'yahoo:crypto:TEST':{provider:'yahoo',assetType:'crypto',symbol:'TEST',coveredStart:'2020-01-01',coveredEnd:'2020-01-02',points:[{date:'2020-01-01',price:1_000_001}]}},'yahoo',[{...asset,quantity:1}])[0].points).toEqual([]);
});

describe('exact dated targets and supported decimals',()=>{
  it.each(['cash','debt'] as const)('%s cents stay exact and no-op targets stay no-op',kind=>{
    for(const [from,to,expected] of [['12.34','12.35','0.01'],['0.10','0.30','0.2'],['12.34','12.33','-0.01']]) expect(datedBalanceDelta(ledger([account(kind,from)]),kind,to,'2020-01-02')).toBe(expected);
    expect(datedBalanceDelta(ledger([account(kind,'12.34')]),kind,'12.34','2020-01-02')).toBeUndefined();
    for(const bad of ['-1','1.001','1e3',String(MAX_MONEY+1)]) expect(datedBalanceDelta(ledger(),kind,bad,'2020-01-02')).toBeUndefined();
  });
  it.each(['cash','debt'] as const)('%s backdated targets use that date, then later activity replays',kind=>{
    const later:LedgerEvent={...base,id:'later',date:'2020-01-03',sequence:1,eventType:`${kind}_adjustment`,amount:'50'};
    const original=ledger([account(kind,'100'),later]);
    const amount=datedBalanceDelta(original,kind,'200','2020-01-02')!;
    const event:LedgerEvent={...base,id:'set',date:'2020-01-02',sequence:1,eventType:`${kind}_adjustment`,amount};
    const saved=updateLedgerEvent(original,event,'2020-12-31').ledger!;
    expect(replayLedger(saved,'2020-01-02','2020-12-31').state[kind]).toBe(200);
    expect(replayLedger(JSON.parse(JSON.stringify(saved)),undefined,'2020-12-31').state[kind]).toBe(250);
    expect(datedBalanceDelta(original,kind,'200','2020-01-04')).toBe('50');
  });
  it('keeps edit sequence before later same-day activity and appends new targets after it',()=>{
    const events=[account('cash','100'),{...base,id:'deposit',eventType:'cash_deposit' as const,date:'2020-01-02',sequence:2,amount:'50'}];
    const edit={...base,id:'set',date:'2020-01-02',sequence:1,eventType:'cash_adjustment' as const,amount:'10'};
    expect(datedBalanceDelta(ledger([...events,edit]),'cash','200',edit.date,edit)).toBe('100');
    expect(datedBalanceDelta(ledger(events),'cash','200',edit.date)).toBe('50');
  });
  it.each(['0.00000001','0.0000001','0.000001','0.125'])('preserves %s units exactly',quantity=>{
    const event=buildTradeEvent({side:'buy',assetId:asset.id,date:'2020-01-01',sequence:1,quantity,mode:'unit',unitPrice:'1000000',affectsCashDebt:false},'2020-12-31',stamp).event!;
    expect(event.quantity).toBe(quantity);expect(replayLedger(ledger([event])).state.positions[0].quantityDecimal).toBe(quantity);
  });
  it('rejects unsupported magnitudes and nonfinite conversions',()=>{
    for(const bad of ['1e-8','1000001','Infinity','NaN','999999999999999999999999999999999999']) expect(parseFixed(bad,8)).toBeUndefined();
    expect(()=>safeNumber(Infinity)).toThrow();expect(()=>safeNumber(MAX_MONEY+1)).toThrow();
    expect(effectiveUnitPrice('1000000000000','0.00000001')).toBeUndefined();
  });
  it('accepts equivalent zero-net sales in total and unit modes',()=>{
    const original=ledger([buy()]);
    for(const mode of ['total','unit'] as const){const event=buildTradeEvent({id:'sell',side:'sell',assetId:asset.id,date:'2020-01-02',sequence:1,quantity:'1',mode,unitPrice:'1',fees:'1',totalAmount:'0',affectsCashDebt:false},'2020-12-31',stamp).event!;expect(event.totalAmount).toBe('0');expect(updateLedgerEvent(original,event,'2020-12-31').issues).toEqual([]);}
  });
  it.each([null,42,{id:'missing'}])('never drops malformed stored records: %j',event=>expect(()=>sanitizeLedger({...ledger(),events:[event]})).toThrow('INTEGRITY_ERROR'));
});

describe('quote correctness and request lifecycle',()=>{
  it('refreshes stale automatic prices before offering a confirmed fallback',async()=>{
    const stale=quote({timestamp:now-30*86_400_000,status:'cached'});
    const refresh=vi.fn().mockResolvedValue([quote({price:6})]);
    expect(await resolveCurrentTradePrice(stale,refresh,'regular',()=>now)).toMatchObject({source:'current_quote',unitPrice:'6.000000',requiresConfirmation:false});expect(refresh).toHaveBeenCalledOnce();
    const failed=vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolveCurrentTradePrice(stale,failed,'regular',()=>now)).toMatchObject({source:'stale_quote_confirmed',requiresConfirmation:true,marketTimestamp:stale.timestamp});
  });
  it('isolates quote-source changes from a changed ledger quantity',()=>{
    const afterEdit=replayLedger(ledger([buy('edited','4')])).state;
    expect(detectLedgerPriceSourceTransition(afterEdit,[quote({status:'cached'})],[quote()],now)).toBeUndefined();
  });
  it('allows an explicit change from extended to the older regular close',()=>{
    const holdings=[{id:asset.id,symbol:'TEST',type:'crypto' as const,quantity:2}];
    expect(mergeIncomingQuotes([quote({session:'extended',price:8})],[quote({session:'regular',timestamp:now-1000})],holdings,now)[0]).toMatchObject({price:5,session:'regular'});
  });
  it('requires confirmation for a month-old quote and retains the real price date',()=>{
    const old=quote({timestamp:now-30*86_400_000,status:'cached'});
    expect(quoteTradePrice(old,now)).toMatchObject({source:'stale_quote_confirmed',requiresConfirmation:true,priceDate:localCalendarDate(old.timestamp),marketTimestamp:old.timestamp});
    expect(quoteTradePrice(quote(),now)).toMatchObject({source:'current_quote',requiresConfirmation:false});
  });
  it('distinguishes market-closed stocks from stale crypto',()=>{
    const weekend=Date.parse('2020-02-08T18:00:00Z');
    expect(quoteFreshness(quote({assetType:'stock',timestamp:weekend-86_400_000}),weekend)).toBe('closed');
    expect(quoteFreshness(quote({timestamp:weekend-86_400_000}),weekend)).toBe('stale');
  });
  it('rejects non-USD prices at normalization, cache, valuation and trade boundaries',()=>{
    const foreign=quote({currency:'EUR'});const holdings=[{id:asset.id,symbol:'TEST',type:'crypto' as const,quantity:2}];
    expect(()=>normalizeYahooQuote({chart:{result:[{meta:{currency:'EUR',regularMarketPrice:5}}]}},holdings[0])).toThrow('UNSUPPORTED CURRENCY');
    expect(preferredStoredQuotes([foreign],holdings,now)).toEqual([]);
    expect(calculateLedgerPortfolio(replayLedger(ledger([buy()])).state,[foreign]).totalValue).toBe(0);
    expect(quoteTradePrice(foreign,now)).toBeUndefined();
  });
  it('keeps newer real prices over older incoming or demo values',()=>{
    const holdings=[{id:asset.id,symbol:'TEST',type:'crypto' as const,quantity:2}];
    expect(mergeIncomingQuotes([quote()],[quote({timestamp:now-1000,price:1})],holdings,now)[0].price).toBe(5);
    expect(preferredStoredQuotes([quote(),quote({timestamp:now+1000,status:'mock',price:99})],holdings,now,true)[0].price).toBe(5);
    expect(mergeIncomingQuotes([quote()],[],holdings,now)[0].price).toBe(5);
  });
  it('does not invent missing timestamps and rejects implausible future times',()=>{
    const q=normalizeYahooQuote({chart:{result:[{meta:{currency:'USD',regularMarketPrice:5}}]}},{id:'test',symbol:'TEST',type:'stock',quantity:1});
    expect(q.timestamp).toBe(0);expect(quoteTradePrice(q,now)).toBeUndefined();
    expect(validQuote(quote({timestamp:now+3600000}),now)).toBe(false);
  });
  it('times out a stuck request and allows retry',async()=>{
    vi.useFakeTimers();const queue=new RefreshQueue();const failed=queue.run(()=>withTimeout(new Promise<never>(()=>{}),100));const assertion=expect(failed).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(101);await assertion;
    const retry=vi.fn().mockResolvedValue(undefined);await queue.run(retry);expect(retry).toHaveBeenCalledOnce();
  });
  it('coalesces config changes into one latest-generation follow-up',async()=>{
    let finish!:()=>void;const seen:number[]=[];const queue=new RefreshQueue();
    const work=async(g:number)=>{seen.push(g);if(seen.length===1)await new Promise<void>(r=>finish=r);};
    const active=queue.run(work);queue.invalidate();await queue.run(work);queue.invalidate();await queue.run(work);finish();await active;expect(seen).toEqual([0,2]);
  });
});

describe('history safety and scaling',()=>{
  it('discards malformed symbol caches independently from the ledger',()=>{
    expect(sanitizeLedgerPriceCache({schemaVersion:1,entries:{bad:{assetId:'test',symbol:42,assetType:'crypto',coveredThrough:stamp,points:[]}}}).entries).toEqual({});
  });
  it('requests the local day start rather than UTC midnight',async()=>{
    const getHourlyPrices=vi.fn().mockResolvedValue({series:[],errors:[]});
    await syncLedgerPriceCache({getHourlyPrices} as unknown as PriceProvider,ledger(),{schemaVersion:1,entries:{}},'2020-01-01','2020-01-02T12:00:00Z');
    expect(getHourlyPrices.mock.calls[0][1]).toBe(localCalendarStartTimestamp('2020-01-01'));
  });
  it('matches deterministic replay with 1000 events and 1000 history points without multi-second replay',()=>{
    const events=Array.from({length:1000},(_,i)=>({...buy(`synthetic-${i}`,'1'),sequence:i+1}));
    const points=Array.from({length:1000},(_,i)=>({timestamp:new Date(Date.parse(localCalendarStartTimestamp('2020-01-01'))+i*3600000).toISOString(),price:5+i/100}));
    const cache={schemaVersion:1 as const,entries:{'crypto:TEST':{assetId:asset.id,symbol:'TEST',assetType:'crypto' as const,coveredThrough:points.at(-1)!.timestamp,points}}};
    const start=performance.now();const history=calculateLedgerHistory(ledger(events),cache,'2020-01-01',points.at(-1)!.timestamp);const elapsed=performance.now()-start;
    expect(history.at(-1)!.value).toBeCloseTo(replayLedger(ledger(events)).state.positions[0].quantity*points.at(-1)!.price);
    expect(elapsed).toBeLessThan(2500);
  });
});
