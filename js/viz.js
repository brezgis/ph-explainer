/* viz.js — canvas plumbing and chart components.
 * Everything reads its colors from the CSS custom properties at draw time,
 * so the whole page re-renders correctly when the theme flips.
 */
(function () {
  'use strict';

  // ---------- theme ----------

  const TOKENS = ['paper', 'ink', 'ink-soft', 'ink-faint', 'hair',
    'h0', 'h1', 'wash', 'wash-tri', 'sweep', 'hi'];

  const Theme = {
    _cache: null,
    _listeners: new Set(),
    get() {
      if (!this._cache) {
        const cs = getComputedStyle(document.documentElement);
        const c = {};
        for (const t of TOKENS) c[t.replace(/-(.)/g, (_, ch) => ch.toUpperCase())] =
          cs.getPropertyValue('--' + t).trim();
        this._cache = c;
      }
      return this._cache;
    },
    onChange(fn) { this._listeners.add(fn); },
    _bust() { this._cache = null; for (const fn of this._listeners) fn(); },
  };
  matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => Theme._bust());
  new MutationObserver(() => Theme._bust())
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- canvas env ----------

  // Wraps a canvas: DPR-aware sizing (CSS height taken from the height
  // attribute; without one, the canvas fills whatever height CSS gives it),
  // redraw on resize and theme change.
  function makeCanvas(canvas, drawFn) {
    const attrH = parseInt(canvas.getAttribute('height'), 10);
    const cssH = Number.isFinite(attrH) ? attrH : 0;
    if (cssH) canvas.style.height = cssH + 'px';
    const env = {
      canvas,
      ctx: canvas.getContext('2d'),
      w: 0, h: cssH,
      dpr: 1,
      _off: null,
      // disabled envs never touch the canvas — several envs may share one
      // canvas (barcode ⇄ diagram views) and only the active one may size,
      // clear, or draw it; flipping enabled back on re-sizes and redraws.
      _enabled: true,
      get enabled() { return this._enabled; },
      set enabled(v) {
        const was = this._enabled;
        this._enabled = v;
        if (v && !was) resize();
      },
      draw() {
        if (!env.w || !env._enabled) return;
        env.ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
        env.ctx.clearRect(0, 0, env.w, env.h);
        drawFn(env);
      },
    };
    const resize = () => {
      if (!env._enabled) return;
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      const h = cssH || canvas.clientHeight;
      if (!w || !h) return;
      env.dpr = window.devicePixelRatio || 1;
      env.w = w; env.h = h;
      canvas.width = Math.round(w * env.dpr);
      canvas.height = Math.round(h * env.dpr);
      env.draw();
    };
    new ResizeObserver(resize).observe(canvas);
    Theme.onChange(() => env.draw());
    resize();
    return env;
  }

  // world rect [0,worldW]x[0,1] -> centered box in the canvas
  function mapper(env, worldW, pad) {
    worldW = worldW || 1; pad = pad === undefined ? 16 : pad;
    const s = Math.min((env.w - 2 * pad) / worldW, env.h - 2 * pad);
    const ox = (env.w - worldW * s) / 2, oy = (env.h - s) / 2;
    return {
      s,
      x: (wx) => ox + wx * s,
      y: (wy) => oy + wy * s,
      fromX: (px) => (px - ox) / s,
      fromY: (py) => (py - oy) / s,
      d: (wd) => wd * s,
    };
  }

  // ---------- primitive renderers ----------

  function drawPoints(env, map, pts, opts) {
    opts = opts || {};
    const ctx = env.ctx;
    const rad = opts.r || 3.2;
    ctx.fillStyle = opts.color || Theme.get().ink;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (opts.skip && opts.skip.has(i)) continue;
      const x = map.x(pts[i][0]), y = map.y(pts[i][1]);
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, 2 * Math.PI);
    }
    ctx.fill();
    if (opts.highlight && opts.highlight.size) {
      ctx.fillStyle = opts.hiColor || Theme.get().hi;
      ctx.strokeStyle = opts.hiColor || Theme.get().hi;
      ctx.lineWidth = 1.5;
      for (const i of opts.highlight) {
        const x = map.x(pts[i][0]), y = map.y(pts[i][1]);
        ctx.beginPath(); ctx.arc(x, y, rad + 0.8, 0, 2 * Math.PI); ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, rad + 4.2, 0, 2 * Math.PI); ctx.stroke();
      }
    }
  }

  function drawEdges(env, map, pts, edges, opts) {
    opts = opts || {};
    const ctx = env.ctx;
    ctx.strokeStyle = opts.color || Theme.get().inkFaint;
    ctx.lineWidth = opts.width || 1;
    ctx.beginPath();
    for (const [i, j] of edges) {
      ctx.moveTo(map.x(pts[i][0]), map.y(pts[i][1]));
      ctx.lineTo(map.x(pts[j][0]), map.y(pts[j][1]));
    }
    ctx.stroke();
  }

  // flat-alpha union: paint opaquely into an offscreen, composite once
  function unionLayer(env, alpha, color, paint) {
    if (!env._off) env._off = document.createElement('canvas');
    const off = env._off;
    if (off.width !== env.canvas.width || off.height !== env.canvas.height) {
      off.width = env.canvas.width; off.height = env.canvas.height;
    }
    const octx = off.getContext('2d');
    octx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    octx.clearRect(0, 0, env.w, env.h);
    octx.fillStyle = color;
    paint(octx);
    env.ctx.save();
    env.ctx.globalAlpha = alpha;
    env.ctx.setTransform(1, 0, 0, 1, 0, 0);
    env.ctx.drawImage(off, 0, 0);
    env.ctx.restore();
    env.ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
  }

  function unionDisks(env, map, pts, rWorld, alpha, color) {
    if (rWorld <= 0) return;
    unionLayer(env, alpha, color, (octx) => {
      const rp = map.d(rWorld);
      octx.beginPath();
      for (const p of pts) {
        const x = map.x(p[0]), y = map.y(p[1]);
        octx.moveTo(x + rp, y);
        octx.arc(x, y, rp, 0, 2 * Math.PI);
      }
      octx.fill();
    });
  }

  function unionTris(env, map, pts, tris, alpha, color) {
    if (!tris.length) return;
    unionLayer(env, alpha, color, (octx) => {
      octx.beginPath();
      for (const [i, j, k] of tris) {
        octx.moveTo(map.x(pts[i][0]), map.y(pts[i][1]));
        octx.lineTo(map.x(pts[j][0]), map.y(pts[j][1]));
        octx.lineTo(map.x(pts[k][0]), map.y(pts[k][1]));
        octx.closePath();
      }
      octx.fill();
    });
  }

  const SANS = '11px system-ui, sans-serif';
  const MONO = '11px ui-monospace, Menlo, Consolas, monospace';

  function niceStep(max) {
    for (const s of [0.02, 0.05, 0.1, 0.2, 0.5]) if (max / s <= 7) return s;
    return 1;
  }

  function fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }

  // ---------- barcode ----------

  // Bars arrive in engine units (Rips scale ε); displayed in disk-radius
  // units r = ε/2. opts: { dims: [0,1], rMax, panelLabels }
  function Barcode(canvas, opts) {
    const self = {
      bars: [], sweepR: 0, hover: null,
      onHover: null,      // (bar|null) => void
      env: null,
      _rows: [],          // {bar, panel, y, h}
    };
    const dims = opts.dims;
    const rMax = opts.rMax;
    const PAD_L = 40, PAD_R = 16, PAD_T = 8, AXIS_H = 26, GAP = 14;

    function visible(dim) {
      const eps = 1e-9;
      // drop zero-persistence pairs and anything born beyond the plotted window
      const out = self.bars.filter(b =>
        b.dim === dim && b.death - b.birth > eps && b.birth / 2 <= rMax);
      if (dim === 0) out.sort((a, b) => b.death - a.death);
      else out.sort((a, b) => (a.birth - b.birth) || (b.death - a.death));
      return out;
    }

    function draw(env) {
      const C = Theme.get();
      const ctx = env.ctx;
      const W = env.w, H = env.h;
      const plotW = W - PAD_L - PAD_R;
      const X = (r) => PAD_L + Math.min(r / rMax, 1) * plotW;
      const panelH = (H - PAD_T - AXIS_H - GAP * (dims.length - 1)) / dims.length;
      self._rows = [];

      // axis
      const step = niceStep(rMax);
      ctx.font = SANS;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.strokeStyle = C.hair; ctx.lineWidth = 1;
      const axisY = H - AXIS_H + 6;
      for (let v = 0; v <= rMax + 1e-9; v += step) {
        const x = X(v);
        ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, axisY - 3); ctx.stroke();
        ctx.fillStyle = C.inkFaint;
        ctx.fillText(fmt(v), x, axisY);
      }
      ctx.fillStyle = C.inkFaint;
      ctx.textAlign = 'right';
      ctx.fillText('r', W - 4, axisY);

      dims.forEach((dim, pi) => {
        const top = PAD_T + pi * (panelH + GAP);
        const bars = visible(dim);
        const col = dim === 0 ? C.h0 : C.h1;
        // panel label
        ctx.font = SANS; ctx.fillStyle = C.inkSoft;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(dim === 0 ? 'H₀' : 'H₁', 6, top + 1);
        if (!bars.length) {
          ctx.fillStyle = C.inkFaint;
          ctx.fillText(dim === 0 ? '' : 'no loops yet', PAD_L + 6, top + panelH / 2 - 6);
          return;
        }
        const rowH = Math.max(2, Math.min(9, panelH / bars.length));
        const barTh = Math.max(1.4, rowH - 2.2);
        bars.forEach((b, ri) => {
          const y = top + ri * rowH + rowH / 2;
          if (y > top + panelH) return;
          const x0 = X(b.birth / 2);
          const inf = b.death === Infinity;
          const x1 = inf ? W - PAD_R + 8 : X(b.death / 2);
          const isHover = self.hover === b;
          ctx.strokeStyle = isHover ? C.hi : col;
          ctx.lineWidth = isHover ? barTh + 1.6 : barTh;
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
          if (inf) { // arrowhead
            ctx.beginPath();
            ctx.moveTo(x1 + 5, y); ctx.lineTo(x1 - 1, y - 3.4); ctx.lineTo(x1 - 1, y + 3.4);
            ctx.closePath(); ctx.fillStyle = isHover ? C.hi : col; ctx.fill();
          }
          if (isHover) {
            ctx.font = MONO; ctx.fillStyle = C.hi;
            ctx.textBaseline = 'bottom';
            const label = inf
              ? `born ${fmt(b.birth / 2)} · lives forever`
              : `${fmt(b.birth / 2)} → ${fmt(b.death / 2)}`;
            ctx.textAlign = x0 < W / 2 ? 'left' : 'right';
            const lx = x0 < W / 2 ? Math.max(x0, PAD_L) + 4 : Math.min(x1, W - PAD_R) - 4;
            ctx.fillText(label, lx, Math.max(y - 4, top + 11));
          }
          self._rows.push({ bar: b, y, h: Math.max(rowH, 5), top, panelH });
        });
      });

      // sweep line
      const sx = X(self.sweepR);
      ctx.strokeStyle = C.sweep; ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(sx, PAD_T - 2); ctx.lineTo(sx, axisY - 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    self.env = makeCanvas(canvas, draw);

    canvas.addEventListener('mousemove', (ev) => {
      if (!self.env.enabled) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let best = null, bd = 7;
      for (const row of self._rows) {
        const d = Math.abs(row.y - my);
        if (d < bd && mx > PAD_L - 12) { bd = d; best = row.bar; }
      }
      if (best !== self.hover) {
        self.hover = best;
        self.env.draw();
        if (self.onHover) self.onHover(best);
      }
    });
    canvas.addEventListener('mouseleave', () => {
      if (!self.env.enabled) return;
      if (self.hover) {
        self.hover = null; self.env.draw();
        if (self.onHover) self.onHover(null);
      }
    });

    self.set = (bars) => { self.bars = bars; self.hover = null; self.env.draw(); };
    self.sweep = (r) => { self.sweepR = r; self.env.draw(); };
    self.redraw = () => self.env.draw();
    return self;
  }

  // ---------- persistence diagram ----------

  function Diagram(canvas, opts) {
    const self = { bars: [], hover: null, onHover: null, env: null, _pts: [] };
    const rMax = opts.rMax;
    const dims = opts.dims || [0, 1];
    const PAD_L = 46, PAD_R = 18, PAD_T = 26, PAD_B = 34;

    function draw(env) {
      const C = Theme.get();
      const ctx = env.ctx;
      const side = Math.min(env.w - PAD_L - PAD_R, env.h - PAD_T - PAD_B);
      const ox = PAD_L + (env.w - PAD_L - PAD_R - side) / 2;
      const oy = PAD_T;
      const X = (r) => ox + (r / rMax) * side;
      const Y = (r) => oy + side - (r / rMax) * side;
      self._pts = [];

      // frame + grid
      ctx.strokeStyle = C.hair; ctx.lineWidth = 1;
      const step = niceStep(rMax);
      ctx.font = SANS; ctx.fillStyle = C.inkFaint;
      for (let v = 0; v <= rMax + 1e-9; v += step) {
        ctx.beginPath(); ctx.moveTo(X(v), oy); ctx.lineTo(X(v), oy + side); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox, Y(v)); ctx.lineTo(ox + side, Y(v)); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(fmt(v), X(v), oy + side + 6);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(v), ox - 6, Y(v));
      }
      // diagonal
      ctx.strokeStyle = C.inkFaint;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(rMax), Y(rMax)); ctx.stroke();
      ctx.setLineDash([]);
      // infinity strip
      const yInf = oy - 12;
      ctx.fillStyle = C.inkFaint;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('∞', ox - 18, yInf);
      // axis titles
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('birth', ox + side / 2, oy + side + 18);
      ctx.save();
      ctx.translate(ox - 32, oy + side / 2); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = 'bottom';
      ctx.fillText('death', 0, 0);
      ctx.restore();

      // legend in the always-empty lower-right triangle
      ctx.font = SANS; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const lx = ox + side - 78, ly = oy + side - 26;
      ctx.fillStyle = C.h0;
      ctx.beginPath(); ctx.arc(lx, ly, 4, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = C.inkSoft; ctx.fillText('H₀', lx + 9, ly + 0.5);
      ctx.fillStyle = C.h1;
      tri(ctx, lx + 38, ly, 4.6); ctx.fill();
      ctx.fillStyle = C.inkSoft; ctx.fillText('H₁', lx + 47, ly + 0.5);

      // points
      const eps = 1e-9;
      for (const b of self.bars) {
        if (dims.indexOf(b.dim) < 0) continue;
        if (b.death - b.birth <= eps) continue;
        if (b.birth / 2 > rMax) continue; // born beyond the plotted window
        const inf = b.death === Infinity;
        const px = X(b.birth / 2);
        const py = inf ? yInf : Y(Math.min(b.death / 2, rMax));
        const isHover = self.hover === b;
        ctx.fillStyle = isHover ? C.hi : (b.dim === 0 ? C.h0 : C.h1);
        if (b.dim === 0) {
          ctx.beginPath(); ctx.arc(px, py, isHover ? 5.4 : 3.8, 0, 2 * Math.PI); ctx.fill();
        } else {
          tri(ctx, px, py, isHover ? 6.2 : 4.6); ctx.fill();
        }
        self._pts.push({ bar: b, px, py });
        if (isHover) {
          ctx.font = MONO; ctx.fillStyle = C.hi;
          ctx.textAlign = px < ox + side / 2 ? 'left' : 'right';
          ctx.textBaseline = 'bottom';
          const label = inf
            ? `H${b.dim === 0 ? '₀' : '₁'} · born ${fmt(b.birth / 2)} · ∞`
            : `H${b.dim === 0 ? '₀' : '₁'} · ${fmt(b.birth / 2)} → ${fmt(b.death / 2)}`;
          ctx.fillText(label, px + (px < ox + side / 2 ? 8 : -8), py - 6);
        }
      }
    }

    function tri(ctx, x, y, s) {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x + s * 0.87, y + s * 0.5);
      ctx.lineTo(x - s * 0.87, y + s * 0.5);
      ctx.closePath();
    }

    self.env = makeCanvas(canvas, draw);

    canvas.addEventListener('mousemove', (ev) => {
      if (!self.env.enabled) return;
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let best = null, bd = 11;
      for (const p of self._pts) {
        const d = Math.hypot(p.px - mx, p.py - my);
        if (d < bd) { bd = d; best = p.bar; }
      }
      if (best !== self.hover) {
        self.hover = best; self.env.draw();
        if (self.onHover) self.onHover(best);
      }
    });
    canvas.addEventListener('mouseleave', () => {
      if (!self.env.enabled) return;
      if (self.hover) {
        self.hover = null; self.env.draw();
        if (self.onHover) self.onHover(null);
      }
    });

    self.set = (bars) => { self.bars = bars; self.hover = null; self.env.draw(); };
    self.redraw = () => self.env.draw();
    return self;
  }

  window.VIZ = {
    Theme, reducedMotion, makeCanvas, mapper,
    drawPoints, drawEdges, unionDisks, unionTris,
    Barcode, Diagram, fmt, SANS, MONO,
  };
})();
