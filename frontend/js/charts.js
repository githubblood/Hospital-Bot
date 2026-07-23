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

// One shared tooltip element for every chart on the page (same pattern as
// Toast's shared container) rather than one per chart instance.
function ensureChartTooltip() {
    let tip = document.querySelector('.chart-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tooltip';
        document.body.appendChild(tip);
    }
    return tip;
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
    const {
        xKey, yKey, color, height = defaultChartHeight(),
        formatValue = (v) => v, formatLabel = (v) => String(v),
        // Richer per-point wording for the hover tooltip only — the axis
        // stays terse (formatLabel) since axis labels have to survive tight
        // spacing; the tooltip has room to spell the date out.
        formatTooltipLabel,
        // Optional: makes each point clickable/Enter-able for drill-down
        // (e.g. the dashboard's per-day chart jumps into Appointments
        // filtered to that date). Called with (dataPoint, index).
        onPointClick
    } = opts;
    container.innerHTML = '';
    if (!data || data.length === 0) return emptyState(container);

    const tooltipLabel = formatTooltipLabel || formatLabel;
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

    // Crosshair — hidden until hover/focus, snaps to the nearest point's x
    // (per the dataviz skill: "the crosshair finds the X... readers aim at
    // a date, never at a 2px line").
    const crosshair = svgEl('line', {
        x1: 0, x2: 0, y1: padding.top, y2: padding.top + plotH,
        stroke: chartGrid(), 'stroke-width': 1, 'stroke-dasharray': '3,3'
    });
    crosshair.style.opacity = 0;
    svg.appendChild(crosshair);

    const labelEvery = labelStep(data.length, plotW, 40);
    const dots = [];
    points.forEach(([x, y], i) => {
        const dot = svgEl('circle', { cx: x, cy: y, r: 4, fill: lineColor, stroke: chartSurface(), 'stroke-width': 2, class: 'chart-dot' });
        svg.appendChild(dot);
        dots.push(dot);

        if (i % labelEvery === 0 || i === data.length - 1) {
            const lbl = svgEl('text', { x, y: padding.top + plotH + 14, 'text-anchor': 'middle', 'font-size': 9, fill: chartInk() });
            lbl.textContent = formatLabel(data[i][xKey]);
            svg.appendChild(lbl);
        }
    });

    container.appendChild(svg);

    // ---- Hover/focus layer ----
    // A single transparent hit-rect spanning the whole plot area (bigger
    // than any one 8px dot — see interaction.md's "hit target bigger than
    // the mark") finds the nearest point by x and drives the crosshair,
    // tooltip and a "lift" on that point's dot together. Arrow keys give
    // keyboard users the same per-point detail as pointer hover.
    const tip = ensureChartTooltip();
    const hit = svgEl('rect', {
        x: padding.left, y: padding.top, width: Math.max(plotW, 1), height: Math.max(plotH, 1),
        fill: 'transparent', class: onPointClick ? 'chart-hit chart-hit-clickable' : 'chart-hit',
        tabindex: '0', role: onPointClick ? 'button' : 'img',
        'aria-label': onPointClick ? 'Chart data, use arrow keys to explore and Enter to open a day' : 'Chart data, use arrow keys to explore'
    });
    svg.appendChild(hit);

    let activeIndex = -1;
    function renderTooltipContent(i) {
        tip.innerHTML = '';
        const val = document.createElement('div');
        val.className = 'chart-tooltip-value';
        val.textContent = formatValue(values[i]);
        const lbl = document.createElement('div');
        lbl.className = 'chart-tooltip-label';
        lbl.textContent = tooltipLabel(data[i][xKey]);
        tip.appendChild(val);
        tip.appendChild(lbl);
        if (onPointClick) {
            const hint = document.createElement('div');
            hint.className = 'chart-tooltip-hint';
            hint.textContent = 'Click for details →';
            tip.appendChild(hint);
        }
    }
    function positionTooltip(clientX, clientY) {
        tip.style.left = clientX + 14 + 'px';
        tip.style.top = clientY + 14 + 'px';
    }
    function setActive(i, clientX, clientY) {
        if (i !== activeIndex) {
            if (activeIndex >= 0) dots[activeIndex].setAttribute('r', 4);
            activeIndex = i;
            dots[i].setAttribute('r', 6);
            crosshair.setAttribute('x1', points[i][0]);
            crosshair.setAttribute('x2', points[i][0]);
            crosshair.style.opacity = 1;
            renderTooltipContent(i);
            tip.classList.add('show');
        }
        positionTooltip(clientX, clientY);
    }
    function clearActive() {
        if (activeIndex >= 0) dots[activeIndex].setAttribute('r', 4);
        activeIndex = -1;
        crosshair.style.opacity = 0;
        tip.classList.remove('show');
    }
    function indexFromEvent(e) {
        const rect = hit.getBoundingClientRect();
        const ratio = data.length === 1 ? 0 : (e.clientX - rect.left) / rect.width;
        return Math.min(data.length - 1, Math.max(0, Math.round(ratio * (data.length - 1))));
    }
    function screenPosForIndex(i) {
        const rect = hit.getBoundingClientRect();
        const ratio = data.length === 1 ? 0.5 : i / (data.length - 1);
        return [rect.left + ratio * rect.width, rect.top + rect.height / 2];
    }

    hit.addEventListener('pointermove', (e) => setActive(indexFromEvent(e), e.clientX, e.clientY));
    hit.addEventListener('pointerleave', clearActive);
    hit.addEventListener('blur', clearActive);
    hit.addEventListener('click', (e) => {
        if (!onPointClick) return;
        const i = indexFromEvent(e);
        onPointClick(data[i], i);
    });
    hit.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) return;
        e.preventDefault();
        if (e.key === 'Enter' || e.key === ' ') {
            if (onPointClick && activeIndex >= 0) onPointClick(data[activeIndex], activeIndex);
            return;
        }
        const next = activeIndex < 0 ? 0 : Math.min(data.length - 1, Math.max(0, activeIndex + (e.key === 'ArrowRight' ? 1 : -1)));
        setActive(next, ...screenPosForIndex(next));
    });
}

window.ChartKit = { renderBarChart, renderLineChart, palette: chartPalette };
