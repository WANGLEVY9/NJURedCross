/* ==========================================================================
   chart.js — purpose-built SVG data visuals.
   No charting library and no default library skin: axes are de-emphasised,
   data carries the visual weight, and every chart is interactive.
   ========================================================================== */

import { h, setVars, clear } from '../core/dom.js';
import { prefersReducedMotion } from '../core/motion.js';
import * as fmt from '../core/format.js';

const PALETTE = ['var(--accent)', 'var(--info)', 'var(--success)', 'var(--warning)', 'var(--text-muted)'];

function niceCeil(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function buildPath(points, { smooth = true } = {}) {
  if (!points.length) return '';
  if (points.length === 1 || !smooth) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  }
  let path = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const cx = (current.x + next.x) / 2;
    path += ` C${cx.toFixed(2)} ${current.y.toFixed(2)} ${cx.toFixed(2)} ${next.y.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

/**
 * Multi-series trend with crosshair, hover tooltip and legend toggling.
 * @param {object} config
 * @param {string[]} config.labels
 * @param {Array<{name:string, values:number[], color?:string, area?:boolean}>} config.series
 */
export function trendChart({ labels, series, height = 200, formatValue = (v) => fmt.int(v), ariaLabel = '趋势图' } = {}) {
  const W = 720;
  const H = height;
  const pad = { top: 14, right: 12, bottom: 24, left: 38 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const enabled = new Set(series.map((s) => s.name));
  const tip = h('div', { class: 'chart__tip', hidden: true });
  const svg = h('svg', { attrs: { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': ariaLabel } });
  const node = h('div', { class: 'chart stack-3' }, svg, tip);
  svg.style.height = `${H}px`;

  const draw = () => {
    clear(svg);
    const active = series.filter((s) => enabled.has(s.name));
    const max = niceCeil(Math.max(1, ...active.flatMap((s) => s.values.map((v) => Number(v) || 0))));
    const xFor = (index) => pad.left + (labels.length <= 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW);
    const yFor = (value) => pad.top + plotH - ((Number(value) || 0) / max) * plotH;

    // Axis — deliberately low contrast
    const ticks = 4;
    for (let i = 0; i <= ticks; i += 1) {
      const value = (max / ticks) * i;
      const y = yFor(value);
      svg.append(h('line', { class: 'ch-grid', attrs: { x1: pad.left, x2: W - pad.right, y1: y.toFixed(1), y2: y.toFixed(1) } }));
      svg.append(h('text', { class: 'ch-axis', attrs: { x: pad.left - 8, y: (y + 3).toFixed(1), 'text-anchor': 'end' }, text: fmt.int(value) }));
    }
    labels.forEach((label, index) => {
      if (labels.length > 8 && index % Math.ceil(labels.length / 7) !== 0 && index !== labels.length - 1) return;
      svg.append(h('text', { class: 'ch-axis', attrs: { x: xFor(index).toFixed(1), y: H - 6, 'text-anchor': 'middle' }, text: label }));
    });

    // Series
    active.forEach((entry, seriesIndex) => {
      const color = entry.color || PALETTE[seriesIndex % PALETTE.length];
      const points = entry.values.map((value, index) => ({ x: xFor(index), y: yFor(value) }));
      const linePath = buildPath(points);
      if (entry.area !== false) {
        svg.append(
          h('path', {
            class: 'ch-area',
            attrs: { d: `${linePath} L${xFor(labels.length - 1).toFixed(2)} ${(pad.top + plotH).toFixed(2)} L${xFor(0).toFixed(2)} ${(pad.top + plotH).toFixed(2)} Z`, fill: color },
          }),
        );
      }
      const line = h('path', { class: 'ch-line', attrs: { d: linePath, stroke: color } });
      svg.append(line);
      if (!prefersReducedMotion()) {
        const length = line.getTotalLength?.() || 0;
        if (length) {
          line.setAttribute('stroke-dasharray', String(length));
          line.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: 760, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'forwards' });
          setTimeout(() => line.removeAttribute('stroke-dasharray'), 800);
        }
      }
    });

    const crosshair = h('line', { class: 'ch-cross', attrs: { y1: pad.top, y2: pad.top + plotH, x1: 0, x2: 0 }, hidden: true });
    const markers = active.map((entry, seriesIndex) =>
      h('circle', { class: 'ch-node', attrs: { r: 3.5, fill: entry.color || PALETTE[seriesIndex % PALETTE.length], cx: 0, cy: 0 }, hidden: true }),
    );
    svg.append(crosshair, ...markers);

    const overlay = h('rect', {
      attrs: { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: 'transparent' },
      on: {
        pointermove: (event) => {
          const rect = svg.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          const index = Math.max(0, Math.min(labels.length - 1, Math.round(ratio * (labels.length - 1) - 0)));
          const x = xFor(index);
          crosshair.hidden = false;
          crosshair.setAttribute('x1', x.toFixed(1));
          crosshair.setAttribute('x2', x.toFixed(1));
          markers.forEach((marker, seriesIndex) => {
            marker.hidden = false;
            marker.setAttribute('cx', x.toFixed(1));
            marker.setAttribute('cy', yFor(active[seriesIndex].values[index]).toFixed(1));
          });
          tip.hidden = false;
          clear(tip);
          tip.append(
            h('p', { class: 't-label', text: labels[index] }),
            ...active.map((entry, seriesIndex) =>
              h(
                'div',
                { class: 'row-2 row-between' },
                h(
                  'span',
                  { class: 'row-2' },
                  (() => {
                    const swatch = h('span', { class: 'legend-swatch' });
                    setVars(swatch, { '--swatch': entry.color || PALETTE[seriesIndex % PALETTE.length] });
                    return swatch;
                  })(),
                  h('span', { class: 't-caption', text: entry.name }),
                ),
                h('span', { class: 't-data t-strong', text: formatValue(entry.values[index]) }),
              ),
            ),
          );
          const tipRect = tip.getBoundingClientRect();
          const px = (x / W) * rect.width;
          setVars(tip, {
            '--tip-x': `${Math.max(0, Math.min(px + 12, rect.width - tipRect.width - 4))}px`,
            '--tip-y': `${Math.max(0, pad.top)}px`,
          });
        },
        pointerleave: () => {
          crosshair.hidden = true;
          markers.forEach((marker) => {
            marker.hidden = true;
          });
          tip.hidden = true;
        },
      },
    });
    svg.append(overlay);
  };

  const legend = h(
    'div',
    { class: 'chart__legend' },
    ...series.map((entry, index) => {
      const swatch = h('span', { class: 'legend-swatch' });
      setVars(swatch, { '--swatch': entry.color || PALETTE[index % PALETTE.length] });
      return h(
        'button',
        {
          type: 'button',
          aria: { pressed: 'true' },
          on: {
            click: (event) => {
              const on = event.currentTarget.getAttribute('aria-pressed') === 'true';
              if (on && enabled.size === 1) return;
              if (on) enabled.delete(entry.name);
              else enabled.add(entry.name);
              event.currentTarget.setAttribute('aria-pressed', String(!on));
              draw();
            },
          },
        },
        swatch,
        h('span', { text: entry.name }),
      );
    }),
  );

  draw();
  if (series.length > 1) node.append(legend);
  return node;
}

/**
 * Horizontal ranked bars — ideal for "top N" operational comparisons.
 * @param {Array<{label:string, value:number, extra?:string, color?:string, onClick?:Function}>} data
 */
export function rankedBars({ data, formatValue = (v) => fmt.int(v), max = null, emptyLabel = '暂无数据' } = {}) {
  if (!data.length) return h('p', { class: 't-caption', text: emptyLabel });
  const ceiling = max || Math.max(1, ...data.map((item) => Number(item.value) || 0));
  return h(
    'div',
    { class: 'rank' },
    ...data.map((item, index) => {
      const fillWidth = `${Math.max(1.5, ((Number(item.value) || 0) / ceiling) * 100)}%`;
      const fill = h('span', { class: 'rank__fill' });
      setVars(fill, { '--w': fillWidth, '--c': item.color || 'var(--accent)' });
      if (!prefersReducedMotion()) {
        fill.style.setProperty('--w', '0%');
        setTimeout(() => fill.style.setProperty('--w', fillWidth), 40 + index * 45);
      }
      return h(
        item.onClick ? 'button' : 'div',
        {
          class: 'rank__row',
          type: item.onClick ? 'button' : null,
          on: item.onClick ? { click: item.onClick } : null,
        },
        h('span', { class: 'rank__label t-secondary truncate', text: item.label }),
        h('span', { class: 'rank__track' }, fill),
        h('span', { class: 'rank__value t-data', text: formatValue(item.value) }),
        item.extra ? h('span', { class: 't-caption t-faint', text: item.extra }) : null,
      );
    }),
  );
}

/** Donut for composition with a live centre readout. */
export function donutChart({ segments, centerValue, centerLabel = '', size = 148, thickness = 14 } = {}) {
  const total = segments.reduce((sum, segment) => sum + (Number(segment.value) || 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const svg = h('svg', { attrs: { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': centerLabel || '构成图' } });
  svg.style.width = `${size}px`;
  svg.style.height = `${size}px`;

  svg.append(
    h('circle', {
      attrs: { cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--skeleton-base)', 'stroke-width': thickness },
    }),
  );

  const valueNode = h('b', { class: 't-h2 t-num', text: centerValue === undefined ? fmt.int(total) : String(centerValue) });
  const labelNode = h('span', { class: 't-caption', text: centerLabel });

  let offset = 0;
  segments.forEach((segment, index) => {
    const value = Number(segment.value) || 0;
    if (value <= 0 || total <= 0) return;
    const portion = value / total;
    const arc = h('circle', {
      attrs: {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: 'none',
        stroke: segment.color || PALETTE[index % PALETTE.length],
        'stroke-width': thickness,
        'stroke-linecap': 'butt',
        'stroke-dasharray': `${(circumference * portion).toFixed(2)} ${circumference.toFixed(2)}`,
        'stroke-dashoffset': `${(-circumference * offset).toFixed(2)}`,
        transform: `rotate(-90 ${size / 2} ${size / 2})`,
      },
      on: {
        pointerenter: () => {
          valueNode.textContent = fmt.int(value);
          labelNode.textContent = segment.label;
          arc.setAttribute('stroke-width', String(thickness + 3));
        },
        pointerleave: () => {
          valueNode.textContent = centerValue === undefined ? fmt.int(total) : String(centerValue);
          labelNode.textContent = centerLabel;
          arc.setAttribute('stroke-width', String(thickness));
        },
      },
    });
    if (!prefersReducedMotion()) {
      arc.animate(
        [{ strokeDasharray: `0 ${circumference}` }, { strokeDasharray: `${(circumference * portion).toFixed(2)} ${circumference}` }],
        { duration: 700, delay: index * 90, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'backwards' },
      );
    }
    svg.append(arc);
    offset += portion;
  });

  return h(
    'div',
    { class: 'donut' },
    h('div', { class: 'donut__figure' }, svg, h('div', { class: 'donut__center' }, valueNode, labelNode)),
    h(
      'div',
      { class: 'donut__legend' },
      ...segments.map((segment, index) => {
        const swatch = h('span', { class: 'legend-swatch' });
        setVars(swatch, { '--swatch': segment.color || PALETTE[index % PALETTE.length] });
        return h(
          'div',
          { class: 'row-2' },
          swatch,
          h('span', { class: 't-caption spacer truncate', text: segment.label }),
          h('span', { class: 't-data', text: fmt.int(segment.value) }),
        );
      }),
    ),
  );
}

/** Inline sparkline used inside metric footers and table cells. */
export function sparkline({ values, width = 92, height = 24, color = 'var(--accent)' } = {}) {
  const numbers = values.map((value) => Number(value) || 0);
  const max = Math.max(1, ...numbers);
  const min = Math.min(0, ...numbers);
  const points = numbers.map((value, index) => ({
    x: numbers.length <= 1 ? width / 2 : (index / (numbers.length - 1)) * width,
    y: height - ((value - min) / (max - min || 1)) * height,
  }));
  const svg = h(
    'svg',
    { class: 'spark', attrs: { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' } },
    h('path', { attrs: { d: buildPath(points), fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linecap': 'round' } }),
  );
  svg.style.width = `${width}px`;
  svg.style.height = `${height}px`;
  return svg;
}

export { PALETTE as chartPalette };
