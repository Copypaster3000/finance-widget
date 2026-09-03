<script lang="ts">
  import { money, signedPercent } from '../lib/format';
  import { calculateHistoryChange } from '../lib/history';
  import { HISTORY_RANGE_LABELS } from '../lib/hourly';
  import type { HistoryRange, HistoryWarning, PortfolioHistoryPoint } from '../lib/types';
  import { calendarDateAsLocalDate } from '../lib/calendar';

  export let points: PortfolioHistoryPoint[];
  export let ranges: HistoryRange[];
  export let range: HistoryRange;
  export let onRange: (range: HistoryRange) => void;
  export let loading: boolean;
  export let warning: HistoryWarning | undefined;
  export let onRetry: () => void;
  export let live: boolean;
  export let privacyHidden = false;

  const width = 420;
  const height = 88;
  const top = 7;
  const bottom = 15;
  let hovered = -1;

  type PlotPoint = PortfolioHistoryPoint & { x: number; y: number };

  function plot(values: PortfolioHistoryPoint[]): PlotPoint[] {
    if (!values.length) return [];
    const minimum = Math.min(...values.map((point) => point.value));
    const maximum = Math.max(...values.map((point) => point.value));
    const spread = maximum - minimum || Math.max(maximum * 0.02, 1);
    const inset = spread * 0.12;
    const low = minimum - inset;
    const high = maximum + inset;
    return values.map((point, index) => ({
      ...point,
      x: values.length === 1 ? width : (index / (values.length - 1)) * width,
      y: top + ((high - point.value) / (high - low)) * (height - top - bottom)
    }));
  }

  function smoothPath(values: PlotPoint[]): string {
    if (!values.length) return '';
    if (values.length === 1) return `M 0 ${values[0].y} L ${width} ${values[0].y}`;
    let path = `M ${values[0].x} ${values[0].y}`;
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1];
      const current = values[index];
      const midpoint = (previous.x + current.x) / 2;
      path += ` C ${midpoint} ${previous.y}, ${midpoint} ${current.y}, ${current.x} ${current.y}`;
    }
    return path;
  }

  function pointDate(value: string): Date {
    return value.includes('T') ? new Date(value) : calendarDateAsLocalDate(value);
  }

  function shortDate(date: string): string {
    return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }).format(pointDate(date));
  }

  function axisStart(date: string): string {
    if (range === '1h' || range === '1d') {
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(pointDate(date));
    }
    return shortDate(date);
  }

  function timestampLabel(date: string): string {
    return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(pointDate(date));
  }

  function move(event: PointerEvent) {
    if (!chartPoints.length) return;
    const bounds = (event.currentTarget as SVGElement).getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    hovered = Math.round(ratio * (chartPoints.length - 1));
  }

  $: chartPoints = plot(points);
  $: line = smoothPath(chartPoints);
  $: area = line ? `${line} L ${width} ${height - bottom} L 0 ${height - bottom} Z` : '';
  $: first = chartPoints[0];
  $: last = chartPoints.at(-1);
  $: active = hovered >= 0 ? chartPoints[hovered] : undefined;
  $: change = calculateHistoryChange(points);
</script>

<section class:has-warning={warning} class="history-panel" aria-label="Current holdings portfolio history">
  <div class="history-heading">
    <span>PORTFOLIO HISTORY{#if warning}<i class="history-alert" role="img" aria-label="History partial" title={warning.detail}></i>{/if}</span>
    {#if chartPoints.length}<strong class:negative={!privacyHidden && change < 0}>{privacyHidden ? '****' : signedPercent(change)}</strong>{/if}
  </div>

  {#if loading && !chartPoints.length}
    <div class="history-loading"><i></i><span>RECONSTRUCTING HOURLY VALUE</span></div>
  {:else if !chartPoints.length}
    <div class="history-empty">{warning ? 'HISTORY PARTIAL' : 'NO DATA YET'}</div>
  {:else}
    <div class="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Portfolio history from ${first.date} through now`} on:pointermove={move} on:pointerleave={() => hovered = -1}>
        <defs>
          <linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--accent)" stop-opacity=".2" />
            <stop offset="1" stop-color="var(--accent)" stop-opacity=".015" />
          </linearGradient>
        </defs>
        <path class="area" d={area} />
        <path class="trace" d={line} />
        {#if active}
          <line class="cursor" x1={active.x} x2={active.x} y1={top} y2={height - bottom} />
          <circle class="hover-point" cx={active.x} cy={active.y} r="2.6" />
        {/if}
        {#if last}<circle class:live class="end-point" cx={last.x} cy={last.y} r="2.4" />{/if}
      </svg>
      {#if active}
        <div class="history-tooltip" style={`left:${Math.min(84, Math.max(16, (active.x / width) * 100))}%`}>
          <span>{timestampLabel(active.date)}</span><strong>{privacyHidden ? '******' : money.format(active.value)}</strong>
          <i class:negative={!privacyHidden && active.value < first.value}>{privacyHidden ? '****' : signedPercent(calculateHistoryChange(points, hovered))}</i>
        </div>
      {/if}
      <div class="axis-labels"><span>{axisStart(first.date)}</span><span>NOW</span></div>
    </div>
  {/if}
  {#if warning}<div class="history-warning" title={warning.detail}><span>HISTORY PARTIAL{#if warning.symbols.length} / {warning.symbols.join(', ')}{/if}</span><i>CURRENT VALUES UNAFFECTED</i><button on:click={onRetry}>RETRY</button></div>{/if}
  {#if chartPoints.length}<nav class="history-ranges" aria-label="Portfolio history time window">
    {#each HISTORY_RANGE_LABELS.filter((option) => ranges.includes(option.value)) as option}
      <button class:active={range === option.value} class:optional={option.value !== '1h' && option.value !== 'all'} aria-pressed={range === option.value} on:click={() => onRange(option.value)}>{option.label}</button>
    {/each}
  </nav>{/if}
</section>
