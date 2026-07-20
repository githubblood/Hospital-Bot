// Minimal dependency-free SVG chart kit — bar + line only, the two forms the
// dashboard's real datasets need (magnitude-by-category, magnitude-over-time).
// Follows the project's own validated categorical palette (dataviz skill
// reference default, unchanged) rather than a generated/rainbow set, and the
// skill's fixed mark specs: ≤24px bars with 4px rounded caps, 2px lines,
// hairline gridlines, muted axis ink, native <title> tooltips as the
// zero-JS-dependency hover layer.
const CHART_PALETTE_LIGHT = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const CHART_PALETTE_DARK = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926', '#9085e9', '#e66767'];

// A fixed 220px reads fine on desktop next to 3-4 charts per row, but on a
// full-width mobile chart the same height looks squat relative to how wide
// it now is — taller charts also give touch targets (bars/points, for the
// native <title> tooltip) more room. Callers can still override via
// opts.height; this is only the fallback when they don't.
function defaultChartHeight() {
    return window.innerWidth <= 480 ? 260 : 220;
}

function chartIsDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function chartPalette() { return chartIsDark() ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT; }
function chartInk() { return chartIsDark() ? '#c3c2b7' : '#52514e'; }
function chartGrid() { return chartIsDark() ? '#2c2c2a' : '#e1e0d9'; }
function chartSurface() { return chartIsDark() ? '#16283A' : '#ffffff'; }

function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function axisLayout(container, height) {
    const width = container.clientWidth || 400;
    const padding = { top: 16, right: 12, bottom: 30, left: 38 };
    return { width, height, padding, plotW: width - padding.left - padding.right, plotH: height - padding.top - padding.bottom };
}

// Classic "nice number" tick step (1/2/5/10 × a power of ten) so the axis
// never lands on awkward fractional rounds — naive linear interpolation
// across a fixed step count produces duplicate labels for small integer
// datasets (e.g. max=3 over 4 steps rounds to 0,1,2,2,3).
function niceAxisMax(maxVal, targetSteps) {
    if (maxVal <= 0) return { step: 1, numSteps: 1, niceMax: 1 };
    const roughStep = maxVal / targetSteps;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const residual = roughStep / magnitude;
    let step;
    if (residual > 5) step = 10 * magnitude;
    else if (residual > 2) step = 5 * magnitude;
    else if (residual > 1) step = 2 * magnitude;
    else step = magnitude;
    const numSteps = Math.max(1, Math.ceil(maxVal / step));
    return { step, numSteps, niceMax: step * numSteps };
}

function drawGridAndYAxis(svg, layout, maxVal, formatValue) {
    const { padding, plotW, plotH } = layout;
    const { step, numSteps, niceMax } = niceAxisMax(maxVal, 4);
    for (let i = 0; i <= numSteps; i++) {
        const y = padding.top + plotH - (plotH * i) / numSteps;
        svg.appendChild(svgEl('line', {
            x1: padding.left, x2: padding.left + plotW, y1: y, y2: y,
            stroke: chartGrid(), 'stroke-width': 1
        }));
        const label = svgEl('text', { x: padding.left - 6, y: y + 3, 'text-anchor': 'end', 'font-size': 10, fill: chartInk() });
        label.textContent = formatValue(Math.round(step * i));
        svg.appendChild(label);
    }
    return niceMax;
}

function emptyState(container, message) {
    container.innerHTML = `<div class="chart-empty">${message || 'No data yet.'}</div>`;
}

// How many x-axis labels actually fit without colliding: past ~10 items on
// a wide desktop chart, or far fewer once the same chart is squeezed to a
// 320px-wide mobile screen (a fixed count-based thinning left 24 hourly
// labels overlapping into an unreadable smear on a phone). Each shown label
// needs roughly minLabelPx of its own horizontal room.
function labelStep(dataLength, plotW, minLabelPx = 34) {
    const maxLabels = Math.max(1, Math.floor(plotW / minLabelPx));
    return Math.max(1, Math.ceil(dataLength / Math.min(maxLabels, 10)));
}

function renderBarChart(container, data, opts) {
    const { xKey, yKey, color, height = defaultChartHeight(), formatValue = (v) => v, formatLabel = (v) => String(v) } = opts;
    container.innerHTML = '';
    if (!data || data.length === 0) return emptyState(container);

    const layout = axisLayout(container, height);
    const { width, padding, plotW, plotH } = layout;
    const maxVal = Math.max(1, ...data.map(d => Number(d[yKey]) || 0));
    const barColor = color || chartPalette()[0];
    const slot = plotW / data.length;
    const barW = Math.max(4, Math.min(24, slot - 8));

    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg' });
    const niceMax = drawGridAndYAxis(svg, layout, maxVal, formatValue);
    const labelEvery = labelStep(data.length, plotW);

    data.forEach((d, i) => {
        const val = Number(d[yKey]) || 0;
        const barH = Math.max(1, (val / niceMax) * plotH);
        const x = padding.left + i * slot + (slot - barW) / 2;
        const y = padding.top + plotH - barH;

        const rect = svgEl('rect', { x, y, width: barW, height: barH, rx: 4, ry: 4, fill: barColor, class: 'chart-bar' });
        const title = svgEl('title', {});
        title.textContent = `${formatLabel(d[xKey])}: ${formatValue(val)}`;
        rect.appendChild(title);
        svg.appendChild(rect);

        if (i % labelEvery === 0 || i === data.length - 1) {
            const lbl = svgEl('text', { x: x + barW / 2, y: padding.top + plotH + 14, 'text-anchor': 'middle', 'font-size': 9, fill: chartInk() });
            lbl.textContent = formatLabel(d[xKey]).slice(0, 10);
            svg.appendChild(lbl);
        }
    });

    container.appendChild(svg);
}

function renderLineChart(container, data, opts) {
    const { xKey, yKey, color, height = defaultChartHeight(), formatValue = (v) => v, formatLabel = (v) => String(v) } = opts;
    container.innerHTML = '';
    if (!data || data.length === 0) return emptyState(container);

    const layout = axisLayout(container, height);
    const { padding, plotW, plotH, width } = layout;
    const values = data.map(d => Number(d[yKey]) || 0);
    const maxVal = Math.max(1, ...values);
    const lineColor = color || chartPalette()[0];

    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart-svg' });
    const niceMax = drawGridAndYAxis(svg, layout, maxVal, formatValue);

    const points = data.map((d, i) => [
        padding.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW),
        padding.top + plotH - (values[i] / niceMax) * plotH
    ]);

    const areaPath = `M${points[0][0]},${padding.top + plotH} ${points.map(p => `L${p[0]},${p[1]}`).join(' ')} L${points[points.length - 1][0]},${padding.top + plotH} Z`;
    svg.appendChild(svgEl('path', { d: areaPath, fill: lineColor, opacity: 0.1 }));

    const linePath = `M${points.map(p => p.join(',')).join(' L')}`;
    svg.appendChild(svgEl('path', { d: linePath, fill: 'none', stroke: lineColor, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    const labelEvery = labelStep(data.length, plotW, 40);
    points.forEach(([x, y], i) => {
        const dot = svgEl('circle', { cx: x, cy: y, r: 4, fill: lineColor, stroke: chartSurface(), 'stroke-width': 2 });
        const title = svgEl('title', {});
        title.textContent = `${formatLabel(data[i][xKey])}: ${formatValue(values[i])}`;
        dot.appendChild(title);
        svg.appendChild(dot);

        if (i % labelEvery === 0 || i === data.length - 1) {
            const lbl = svgEl('text', { x, y: padding.top + plotH + 14, 'text-anchor': 'middle', 'font-size': 9, fill: chartInk() });
            lbl.textContent = formatLabel(data[i][xKey]);
            svg.appendChild(lbl);
        }
    });

    container.appendChild(svg);
}

window.ChartKit = { renderBarChart, renderLineChart, palette: chartPalette };
