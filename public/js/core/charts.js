// Small SVG chart kit: stacked columns (time series) and stacked horizontal
// bars (categories). Two series: published and failed. Thin marks, 2px
// surface gaps, 4px rounded data ends, hairline grid, per-mark tooltips.
import { esc, fmt } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";
const GAP = 2;
const RADIUS = 4;

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// Rect with rounded ends on one side only (the data end), square at the baseline.
function roundedPath(x, y, w, h, side) {
  const r = Math.min(RADIUS, side === "top" ? h : w, side === "top" ? w / 2 : h / 2);
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  if (side === "top") {
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function tooltip(container) {
  let tip = container.querySelector(".chart-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tooltip";
    tip.hidden = true;
    container.appendChild(tip);
  }
  return {
    show(title, rows, x, y) {
      tip.innerHTML = `<div class="tt-title">${esc(title)}</div>${rows
        .map((r) => `<div class="tt-row"><span class="key ${r.key}"></span><b>${fmt.number(r.value)}</b><span class="muted">${esc(r.label)}</span></div>`)
        .join("")}`;
      tip.hidden = false;
      const box = container.getBoundingClientRect();
      const w = tip.offsetWidth;
      const left = Math.min(Math.max(8, x - w / 2), box.width - w - 8);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// days: [{ date: "YYYY-MM-DD", success, failed }]
export function stackedColumns(container, days) {
  container.querySelectorAll("svg").forEach((s) => s.remove());
  const width = Math.max(320, container.clientWidth - 40);
  const height = 240;
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...days.map((d) => d.success + d.failed)));
  const band = plotW / Math.max(1, days.length);
  const barW = Math.max(3, Math.min(24, band - 4));
  const y = (v) => pad.t + plotH - (v / max) * plotH;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Stacked columns of published and failed platform publishes per day" });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const yy = Math.round(y(v)) + 0.5;
    svg.appendChild(el("line", { class: i === 0 ? "axis-line" : "grid-line", x1: pad.l, x2: width - pad.r, y1: yy, y2: yy }));
    svg.appendChild(el("text", { class: "tick", x: pad.l - 8, y: yy + 4, "text-anchor": "end" }, fmt.compact(v)));
  }
  const every = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 58))));
  const tip = tooltip(container);

  days.forEach((d, i) => {
    const x = pad.l + i * band + (band - barW) / 2;
    const g = el("g");
    const pubH = (d.success / max) * plotH;
    const failH = (d.failed / max) * plotH;
    const base = pad.t + plotH;
    if (d.success) {
      g.appendChild(el("path", { class: "mark-published", d: roundedPath(x, base - pubH, barW, pubH, d.failed ? "none" : "top") }));
    }
    if (d.failed) {
      const top = base - pubH - (d.success ? GAP : 0) - failH;
      g.appendChild(el("path", { class: "mark-failed", d: roundedPath(x, top, barW, failH, "top") }));
    }
    svg.appendChild(g);
    if (i % every === 0) {
      const label = new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      svg.appendChild(el("text", { class: "tick", x: pad.l + i * band + band / 2, y: height - 6, "text-anchor": "middle" }, label));
    }
    // Hit target: the whole day column, not just the painted bar.
    const title = new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const hit = el("rect", { class: "hit", x: pad.l + i * band, y: pad.t, width: band, height: plotH, tabindex: "0", "aria-label": `${title}: ${d.success} published, ${d.failed} failed` });
    const show = () => {
      g.setAttribute("opacity", "0.8");
      const scale = container.querySelector("svg").getBoundingClientRect().width / width;
      tip.show(
        title,
        [
          { key: "published", label: "published", value: d.success },
          { key: "failed", label: "failed", value: d.failed },
        ],
        (pad.l + i * band + band / 2) * scale + 20,
        (y(d.success + d.failed)) * scale
      );
    };
    const hide = () => {
      g.removeAttribute("opacity");
      tip.hide();
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
    svg.appendChild(hit);
  });
  container.prepend(svg);
}

// rows: [{ label, success, failed }]
export function stackedBars(container, rows) {
  container.querySelectorAll("svg").forEach((s) => s.remove());
  const width = Math.max(320, container.clientWidth - 40);
  const rowH = 40;
  const barH = 18;
  const pad = { l: 92, r: 48, t: 6, b: 6 };
  const height = pad.t + pad.b + rows.length * rowH;
  const plotW = width - pad.l - pad.r;
  const max = niceMax(Math.max(1, ...rows.map((r) => r.success + r.failed)));
  const tip = tooltip(container);
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Published and failed attempts per platform" });
  svg.appendChild(el("line", { class: "axis-line", x1: pad.l + 0.5, x2: pad.l + 0.5, y1: pad.t, y2: height - pad.b }));

  rows.forEach((r, i) => {
    const cy = pad.t + i * rowH + rowH / 2;
    const y0 = cy - barH / 2;
    svg.appendChild(el("text", { class: "label-text", x: pad.l - 10, y: cy + 4, "text-anchor": "end" }, r.label));
    const pubW = (r.success / max) * plotW;
    const failW = (r.failed / max) * plotW;
    const g = el("g");
    if (r.success) g.appendChild(el("path", { class: "mark-published", d: roundedPath(pad.l + 1, y0, pubW, barH, r.failed ? "none" : "right") }));
    if (r.failed) g.appendChild(el("path", { class: "mark-failed", d: roundedPath(pad.l + 1 + pubW + (r.success ? GAP : 0), y0, failW, barH, "right") }));
    svg.appendChild(g);
    const total = r.success + r.failed;
    const endX = pad.l + 1 + pubW + failW + (r.success && r.failed ? GAP : 0);
    svg.appendChild(el("text", { class: "value-text", x: endX + 8, y: cy + 4 }, total ? fmt.number(total) : "0"));
    const hit = el("rect", { class: "hit", x: 0, y: pad.t + i * rowH, width, height: rowH, tabindex: "0", "aria-label": `${r.label}: ${r.success} published, ${r.failed} failed` });
    const show = () => {
      g.setAttribute("opacity", "0.8");
      const scale = container.querySelector("svg").getBoundingClientRect().width / width;
      tip.show(
        r.label,
        [
          { key: "published", label: "published", value: r.success },
          { key: "failed", label: "failed", value: r.failed },
        ],
        (pad.l + Math.max(pubW + failW, 40) / 2) * scale + 20,
        y0 * scale + 8
      );
    };
    const hide = () => {
      g.removeAttribute("opacity");
      tip.hide();
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", show);
    hit.addEventListener("blur", hide);
    svg.appendChild(hit);
  });
  container.prepend(svg);
}
