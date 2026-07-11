/* app.js — the full-screen, click-through edition of the tour.
 *
 * One background canvas (#plane) spans the viewport and is shared by every
 * scene: each scene owns a disabled canvas-env on it and is enabled on entry
 * (viz.js envs are built for this — only the enabled env may size, clear, or
 * draw a shared canvas). Secondary charts (barcodes, the boundary matrix)
 * live on two borderless dock canvases, shared the same way.
 *
 * The world rect [0, W] x [0, 1] (W = 1.6) is letterboxed into #stage — the
 * region right of the floating text — measured at draw time, so layout and
 * CSS stay in charge. Engine times are Rips scale ε; the UI shows r = ε/2.
 */
(function () {
  'use strict';
  const V = window.VIZ, T = V.Theme;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const W = 1.6;

  const planeC = $('#plane');
  const barsC = $('#dock-bars');
  const auxC = $('#dock-aux');
  const stageEl = $('#stage');

  // letterbox world [0,worldW]x[0,1] into #stage's current viewport rect
  // (#plane fills the viewport, so canvas coords == viewport coords)
  function stageMap(worldW, pad) {
    worldW = worldW || 1; pad = pad === undefined ? 26 : pad;
    const r = stageEl.getBoundingClientRect();
    const s = Math.max(1, Math.min((r.width - 2 * pad) / worldW, r.height - 2 * pad));
    const ox = r.left + (r.width - worldW * s) / 2;
    const oy = r.top + (r.height - s) / 2;
    return {
      s,
      x: (wx) => ox + wx * s,
      y: (wy) => oy + wy * s,
      fromX: (px) => (px - ox) / s,
      fromY: (py) => (py - oy) / s,
      d: (wd) => wd * s,
    };
  }

  // ---------- shared helpers (as in the scroll edition) ----------

  function complexAt(filt, eps) {
    const edges = [], tris = [];
    for (const s of filt.simplices) {
      if (s.t > eps) break;
      if (s.dim === 1) edges.push(s.verts);
      else if (s.dim === 2) tris.push(s.verts);
    }
    return { edges, tris };
  }

  function featureOf(bar, filt) {
    if (!bar) return null;
    if (bar.dim === 0) {
      if (!bar._comp) {
        const v = filt.simplices[bar.birthIdx].verts[0];
        bar._comp = new Set(PH.componentAt(filt, v, bar.death));
      }
      return { verts: bar._comp, edges: null };
    }
    if (bar.dim === 1 && bar.rep) {
      const vs = new Set();
      for (const [a, b] of bar.rep) { vs.add(a); vs.add(b); }
      return { verts: vs, edges: bar.rep };
    }
    return null;
  }

  function drawFeature(env, map, pts, feat) {
    if (!feat) return;
    const C = T.get();
    if (feat.edges) V.drawEdges(env, map, pts, feat.edges, { color: C.hi, width: 3.4 });
    V.drawPoints(env, map, pts, { color: 'transparent', highlight: feat.verts, hiColor: C.hi, r: 3.2 });
  }

  function ring(seed, n, noise, cx, cy, R) {
    return PH.presets.noisyRing(seed, n, noise, cx === undefined ? W / 2 : cx, cy === undefined ? 0.5 : cy, R === undefined ? 0.3 : R);
  }
  function blob(seed, n, cx, cy, spread) {
    const r = PH.rng(seed), pts = [];
    for (let i = 0; i < n; i++) {
      const a = r() * 2 * Math.PI, d = Math.sqrt(r()) * spread;
      pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
    }
    return pts;
  }
  function scatter(seed, n) {
    const r = PH.rng(seed), pts = [];
    for (let i = 0; i < n; i++) pts.push([0.12 + r() * (W - 0.24), 0.12 + r() * 0.76]);
    return pts;
  }
  function bindChips(chips, onPick) {
    chips.forEach(ch => ch.addEventListener('click', () => {
      chips.forEach(c => c.classList.toggle('active', c === ch));
      onPick(ch);
    }));
  }

  const scenes = {};

  /* ================= hero background (title & coda) ================= */
  const hero = (() => {
    const N = 44;
    const st = { pts: [], vel: [], A: 2, t: 0, running: false };
    const rand = PH.rng(20260704);
    let env = null, last = 0;

    function seed(A) {
      st.pts = []; st.vel = [];
      for (let i = 0; i < N; i++) {
        st.pts.push([rand() * A, rand()]);
        st.vel.push([(rand() - 0.5) * 0.00005, (rand() - 0.5) * 0.00005]);
      }
    }
    function ensure() {
      if (env) return env;
      env = V.makeCanvas(planeC, (e) => {
        const C = T.get();
        const A = e.w / e.h;
        if (!st.pts.length) seed(A);
        st.A = A;
        const map = { x: (wx) => wx * e.h, y: (wy) => wy * e.h, d: (wd) => wd * e.h };
        const r = 0.055 + 0.02 * Math.sin(st.t * 0.00045);
        const eps = 2 * r;
        V.unionDisks(e, map, st.pts, r, 0.5, C.wash);
        const ctx = e.ctx;
        for (let i = 0; i < st.pts.length; i++)
          for (let j = i + 1; j < st.pts.length; j++) {
            const d = PH.dist(st.pts[i], st.pts[j]);
            if (d < eps) {
              ctx.globalAlpha = Math.min(1, (eps - d) / eps * 2.2) * 0.5;
              ctx.strokeStyle = C.h0; ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(map.x(st.pts[i][0]), map.y(st.pts[i][1]));
              ctx.lineTo(map.x(st.pts[j][0]), map.y(st.pts[j][1]));
              ctx.stroke();
            }
          }
        ctx.globalAlpha = 1;
        V.drawPoints(e, map, st.pts, { color: C.inkSoft, r: 2.6 });
      });
      return env;
    }
    function tick(now) {
      if (!st.running) return;
      const dt = Math.min(50, now - last); last = now;
      st.t = now;
      for (let i = 0; i < st.pts.length; i++) {
        const p = st.pts[i], v = st.vel[i];
        p[0] += v[0] * dt; p[1] += v[1] * dt;
        if (p[0] < 0 || p[0] > st.A) v[0] *= -1;
        if (p[1] < 0 || p[1] > 1) v[1] *= -1;
        p[0] = Math.max(0, Math.min(st.A, p[0]));
        p[1] = Math.max(0, Math.min(1, p[1]));
      }
      env.draw();
      requestAnimationFrame(tick);
    }
    function start() {
      ensure().enabled = true;
      if (V.reducedMotion.matches) { env.draw(); return; }
      if (!st.running) { st.running = true; last = performance.now(); requestAnimationFrame(tick); }
    }
    function stop() {
      st.running = false;
      if (env) env.enabled = false;
    }
    function pdown(ev) {
      if (!env || !env.h) return;
      const rect = planeC.getBoundingClientRect();
      st.pts.push([(ev.clientX - rect.left) / env.h, (ev.clientY - rect.top) / env.h]);
      st.vel.push([(rand() - 0.5) * 0.00007, (rand() - 0.5) * 0.00007]);
      if (st.pts.length > 72) { st.pts.shift(); st.vel.shift(); }
      env.draw();
    }
    return { start, stop, pdown };
  })();

  scenes.top = { init() {}, enter() { hero.start(); }, exit() { hero.stop(); }, pdown: hero.pdown };
  scenes.coda = { init() {}, enter() { hero.start(); }, exit() { hero.stop(); }, pdown: hero.pdown };

  /* ================= §1 the hook ================= */
  scenes.shape = (() => {
    let env;
    const on = new Set();
    return {
      init() {
        const pts = ring(12, 24, 0.045);
        const mean = [
          pts.reduce((s, p) => s + p[0], 0) / pts.length,
          pts.reduce((s, p) => s + p[1], 0) / pts.length,
        ];
        let sxx = 0, syy = 0, sxy = 0;
        for (const p of pts) {
          const dx = p[0] - mean[0], dy = p[1] - mean[1];
          sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
        }
        const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const meanR = pts.reduce((s, p) => s + Math.hypot(p[0] - mean[0], p[1] - mean[1]), 0) / pts.length;

        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          const ctx = e.ctx;
          ctx.font = V.SANS;
          if (on.has('trend')) {
            const L = 0.62;
            ctx.strokeStyle = C.inkFaint; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(map.x(mean[0] - Math.cos(theta) * L), map.y(mean[1] - Math.sin(theta) * L));
            ctx.lineTo(map.x(mean[0] + Math.cos(theta) * L), map.y(mean[1] + Math.sin(theta) * L));
            ctx.stroke();
            ctx.fillStyle = C.inkSoft;
            ctx.textAlign = 'left';
            ctx.fillText('the trend line, shrugging', map.x(mean[0] + Math.cos(theta) * L) - 150, map.y(mean[1] + Math.sin(theta) * L) - 10);
          }
          if (on.has('eye')) {
            ctx.strokeStyle = C.h1; ctx.lineWidth = 2;
            ctx.setLineDash([6, 5]);
            ctx.beginPath();
            ctx.arc(map.x(mean[0]), map.y(mean[1]), map.d(meanR), 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = C.h1; ctx.textAlign = 'center';
            ctx.fillText('a hole, obviously', map.x(mean[0]), map.y(mean[1]) + 5);
          }
          if (on.has('mean')) {
            ctx.fillStyle = C.h0;
            ctx.beginPath(); ctx.arc(map.x(mean[0]), map.y(mean[1]), 5.5, 0, 2 * Math.PI); ctx.fill();
            ctx.strokeStyle = C.h0; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(map.x(mean[0]), map.y(mean[1]), 10, 0, 2 * Math.PI); ctx.stroke();
            ctx.fillStyle = C.inkSoft; ctx.textAlign = 'left';
            ctx.fillText('the average — in the one spot with no data', map.x(mean[0]) + 16, map.y(mean[1]) - 12);
          }
          V.drawPoints(e, map, pts, { color: C.ink, r: 3.6 });
        });

        $$('.ctl[data-scene="shape"] [data-overlay]').forEach(btn => {
          btn.addEventListener('click', () => {
            const k = btn.dataset.overlay;
            if (on.has(k)) on.delete(k); else on.add(k);
            btn.classList.toggle('active', on.has(k));
            env.draw();
          });
        });
      },
      enter() { env.enabled = true; },
      exit() { env.enabled = false; },
    };
  })();

  /* ================= §2 grow ================= */
  scenes.grow = (() => {
    let env, r;
    return {
      init() {
        const pts = ring(5, 22, 0.035).concat(scatter(9, 5));
        const slider = $('#grow-r'), read = $('#grow-read');
        r = parseFloat(slider.value);
        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          V.unionDisks(e, map, pts, r, 0.9, C.wash);
          V.drawPoints(e, map, pts, { color: C.ink, r: 3 });
        });
        slider.addEventListener('input', () => {
          r = parseFloat(slider.value);
          read.textContent = 'r = ' + V.fmt(r);
          env.draw();
        });
      },
      enter() { env.enabled = true; },
      exit() { env.enabled = false; },
    };
  })();

  /* ================= §3 merge (H0) ================= */
  scenes.merge = (() => {
    let env, bc, r, feat = null;
    return {
      init() {
        const pts = blob(41, 9, 0.42, 0.36, 0.09)
          .concat(blob(43, 9, 1.16, 0.62, 0.085))
          .concat([[0.82, 0.16], [0.15, 0.82], [1.42, 0.22]]);
        const { bars, filtration } = PH.persistence(pts);
        const slider = $('#merge-r'), read = $('#merge-read');
        r = parseFloat(slider.value);

        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          V.unionDisks(e, map, pts, r, 0.9, C.wash);
          const { edges } = complexAt(filtration, 2 * r);
          V.drawEdges(e, map, pts, edges, { color: C.inkFaint, width: 1 });
          V.drawPoints(e, map, pts, { color: C.ink, r: 3 });
          drawFeature(e, map, pts, feat);
        });

        bc = V.Barcode(barsC, { dims: [0], rMax: 0.32 });
        bc.set(bars);
        bc.sweep(r);
        bc.onHover = (bar) => { feat = featureOf(bar, filtration); env.draw(); };

        slider.addEventListener('input', () => {
          r = parseFloat(slider.value);
          read.textContent = 'r = ' + V.fmt(r);
          bc.sweep(r);
          env.draw();
        });
      },
      enter() { env.enabled = true; bc.env.enabled = true; },
      exit() { env.enabled = false; bc.env.enabled = false; },
    };
  })();

  /* ================= §4 loops (H1) ================= */
  scenes.loops = (() => {
    let env, bc, r, feat = null, shape = 'ring';
    const cache = {};
    let clouds;
    function data(k) {
      if (!cache[k]) cache[k] = PH.persistence(clouds[k]);
      return cache[k];
    }
    return {
      init() {
        clouds = {
          ring: ring(21, 20, 0.02),
          eight: ring(22, 13, 0.012, W / 2 - 0.235, 0.5, 0.185)
            .concat(ring(23, 12, 0.012, W / 2 + 0.21, 0.5, 0.16)),
          random: scatter(31, 24),
        };
        const slider = $('#loops-r'), read = $('#loops-read');
        r = parseFloat(slider.value);

        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          const pts = clouds[shape];
          const { edges, tris } = complexAt(data(shape).filtration, 2 * r);
          V.unionDisks(e, map, pts, r, 0.45, C.wash);
          V.unionTris(e, map, pts, tris, 0.85, C.washTri);
          V.drawEdges(e, map, pts, edges, { color: C.inkFaint, width: 1 });
          V.drawPoints(e, map, pts, { color: C.ink, r: 3 });
          drawFeature(e, map, pts, feat);
        });

        bc = V.Barcode(barsC, { dims: [1], rMax: 0.3 });
        const refresh = () => {
          feat = null;
          bc.set(data(shape).bars);
          bc.sweep(r);
          env.draw();
        };
        bc.onHover = (bar) => { feat = featureOf(bar, data(shape).filtration); env.draw(); };
        bindChips($$('.ctl[data-scene="loops"] [data-shape]'), (ch) => { shape = ch.dataset.shape; refresh(); });
        slider.addEventListener('input', () => {
          r = parseFloat(slider.value);
          read.textContent = 'r = ' + V.fmt(r);
          bc.sweep(r);
          env.draw();
        });
        refresh();
      },
      enter() { env.enabled = true; bc.env.enabled = true; },
      exit() { env.enabled = false; bc.env.enabled = false; },
    };
  })();

  /* ================= §5 noise & the diagram ================= */
  scenes.noise = (() => {
    let env, bc, dg, view = 'bars';
    let seed = 60, amt, pts, pers, feat = null;
    function regen() {
      pts = ring(seed, 24, amt).concat(scatter(seed + 1, 4));
      pers = PH.persistence(pts);
      feat = null;
    }
    return {
      init() {
        amt = parseFloat($('#noise-amt').value);
        regen();

        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          V.drawPoints(e, map, pts, { color: C.ink, r: 3 });
          drawFeature(e, map, pts, feat);
        });

        bc = V.Barcode(barsC, { dims: [0, 1], rMax: 0.3 });
        dg = V.Diagram(barsC, { rMax: 0.3 });
        dg.env.enabled = false;
        const onHover = (bar) => { feat = featureOf(bar, pers.filtration); env.draw(); };
        bc.onHover = onHover; dg.onHover = onHover;

        const refresh = () => { bc.set(pers.bars); dg.set(pers.bars); env.draw(); };
        refresh();

        $('#noise-amt').addEventListener('input', (ev) => {
          amt = parseFloat(ev.target.value);
          regen(); refresh();
        });
        $('#noise-shuffle').addEventListener('click', () => {
          seed += 13;
          regen(); refresh();
        });
        bindChips($$('.ctl[data-scene="noise"] [data-view]'), (ch) => {
          view = ch.dataset.view === 'diagram' ? 'diagram' : 'bars';
          bc.env.enabled = view === 'bars';
          dg.env.enabled = view === 'diagram';
          (view === 'diagram' ? dg : bc).redraw();
        });
      },
      enter() {
        env.enabled = true;
        (view === 'diagram' ? dg : bc).env.enabled = true;
      },
      exit() {
        env.enabled = false;
        bc.env.enabled = false; dg.env.enabled = false;
      },
    };
  })();

  /* ================= §6 rips mini ================= */
  scenes.rips = (() => {
    let env, r, drag = -1;
    const pts = [[W / 2 - 0.26, 0.62], [W / 2 + 0.24, 0.55], [W / 2 + 0.02, 0.26]];
    return {
      init() {
        const slider = $('#rips-r');
        r = parseFloat(slider.value);
        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          const eps = 2 * r;
          const close = (i, j) => PH.dist(pts[i], pts[j]) <= eps;
          if (close(0, 1) && close(0, 2) && close(1, 2)) {
            e.ctx.fillStyle = C.washTri;
            e.ctx.beginPath();
            e.ctx.moveTo(map.x(pts[0][0]), map.y(pts[0][1]));
            e.ctx.lineTo(map.x(pts[1][0]), map.y(pts[1][1]));
            e.ctx.lineTo(map.x(pts[2][0]), map.y(pts[2][1]));
            e.ctx.closePath(); e.ctx.fill();
          }
          V.unionDisks(e, map, pts, r, 0.45, C.wash);
          e.ctx.strokeStyle = C.inkFaint; e.ctx.lineWidth = 1;
          for (const p of pts) {
            e.ctx.beginPath();
            e.ctx.arc(map.x(p[0]), map.y(p[1]), map.d(r), 0, 2 * Math.PI);
            e.ctx.stroke();
          }
          const edges = [];
          if (close(0, 1)) edges.push([0, 1]);
          if (close(0, 2)) edges.push([0, 2]);
          if (close(1, 2)) edges.push([1, 2]);
          V.drawEdges(e, map, pts, edges, { color: C.h0, width: 2.2 });
          V.drawPoints(e, map, pts, { color: C.ink, r: 5 });
        });
        slider.addEventListener('input', () => { r = parseFloat(slider.value); env.draw(); });
      },
      enter() { env.enabled = true; },
      exit() { env.enabled = false; drag = -1; },
      pdown(ev) {
        const rect = planeC.getBoundingClientRect();
        const map = stageMap(W);
        const wx = map.fromX(ev.clientX - rect.left), wy = map.fromY(ev.clientY - rect.top);
        let best = -1, bd = 0.08;
        pts.forEach((p, i) => {
          const d = Math.hypot(p[0] - wx, p[1] - wy);
          if (d < bd) { bd = d; best = i; }
        });
        drag = best;
        if (drag >= 0) planeC.setPointerCapture(ev.pointerId);
      },
      pmove(ev) {
        if (drag < 0) return;
        const rect = planeC.getBoundingClientRect();
        const map = stageMap(W);
        pts[drag] = [
          Math.max(0.05, Math.min(W - 0.05, map.fromX(ev.clientX - rect.left))),
          Math.max(0.05, Math.min(0.95, map.fromY(ev.clientY - rect.top))),
        ];
        env.draw();
      },
      pup() { drag = -1; },
    };
  })();

  /* ================= §7 chains toy ================= */
  scenes.chain = (() => {
    let env;
    const cx = W / 2, cy = 0.52, R = 0.36;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      pts.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    pts.push([cx, cy]); // g = 6
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [6, 0], [6, 1]];
    const triBoundary = new Set([0, 6, 7]);
    const sel = new Set();

    function boundary() {
      const par = new Map();
      for (const ei of sel)
        for (const v of edges[ei]) par.set(v, (par.get(v) || 0) ^ 1);
      return [...par.entries()].filter(([, odd]) => odd).map(([v]) => v).sort((x, y) => x - y);
    }
    function updateStatus() {
      const status = $('#chain-status');
      const b = boundary();
      if (sel.size === 0) {
        status.innerHTML = '∂c = 0 — the empty chain. Click edges to build one.';
      } else if (b.length) {
        status.innerHTML = `∂c = <strong>${b.map(v => names[v]).join(' + ')}</strong> — not a cycle: the chain has loose ends.`;
      } else if (sel.size === 3 && [...sel].every(e => triBoundary.has(e))) {
        status.innerHTML = '∂c = <strong>0 — a cycle!</strong> But this one is the rim of the shaded triangle: it bounds a filled region, so homology counts it as zero.';
      } else {
        status.innerHTML = '∂c = <strong>0 — a cycle!</strong> Every endpoint cancelled in pairs. And no triangles fill it: this cycle marks a genuine hole. You just evaluated H₁ by hand.';
      }
    }
    return {
      init() {
        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          const ctx = e.ctx;
          ctx.fillStyle = C.washTri;
          ctx.beginPath();
          ctx.moveTo(map.x(pts[6][0]), map.y(pts[6][1]));
          ctx.lineTo(map.x(pts[0][0]), map.y(pts[0][1]));
          ctx.lineTo(map.x(pts[1][0]), map.y(pts[1][1]));
          ctx.closePath(); ctx.fill();
          edges.forEach((ed, i) => {
            ctx.strokeStyle = sel.has(i) ? C.h1 : C.inkFaint;
            ctx.lineWidth = sel.has(i) ? 4 : 1.5;
            ctx.beginPath();
            ctx.moveTo(map.x(pts[ed[0]][0]), map.y(pts[ed[0]][1]));
            ctx.lineTo(map.x(pts[ed[1]][0]), map.y(pts[ed[1]][1]));
            ctx.stroke();
          });
          const b = new Set(boundary());
          V.drawPoints(e, map, pts, { color: C.ink, r: 4, highlight: b, hiColor: C.h0 });
          ctx.font = '13px ui-monospace, Menlo, monospace';
          ctx.fillStyle = C.inkSoft;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          pts.forEach((p, i) => {
            if (i === 6) {
              ctx.fillText(names[i], map.x(p[0]) - 12, map.y(p[1]) + 13);
              return;
            }
            const dx = p[0] - cx, dy = p[1] - cy;
            const L = Math.hypot(dx, dy) || 1;
            ctx.fillText(names[i], map.x(p[0] + dx / L * 0.055), map.y(p[1] + dy / L * 0.055));
          });
        });
        $('#chain-clear').addEventListener('click', () => { sel.clear(); updateStatus(); env.draw(); });
        updateStatus();
      },
      enter() { env.enabled = true; },
      exit() { env.enabled = false; },
      pdown(ev) {
        const rect = planeC.getBoundingClientRect();
        const map = stageMap(W);
        const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
        let best = -1, bd = 12;
        edges.forEach((ed, i) => {
          const x1 = map.x(pts[ed[0]][0]), y1 = map.y(pts[ed[0]][1]);
          const x2 = map.x(pts[ed[1]][0]), y2 = map.y(pts[ed[1]][1]);
          const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
          let t = ((mx - x1) * (x2 - x1) + (my - y1) * (y2 - y1)) / len2;
          t = Math.max(0.08, Math.min(0.92, t));
          const d = Math.hypot(mx - (x1 + t * (x2 - x1)), my - (y1 + t * (y2 - y1)));
          if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0) {
          if (sel.has(best)) sel.delete(best); else sel.add(best);
          updateStatus(); env.draw();
        }
      },
    };
  })();

  /* ================= §8 the stepper ================= */
  scenes.stepper = (() => {
    let planeEnv, matEnv, bc, timer = null, cur = -1;
    let S, m, steps, rawCol, names;
    const pts = [[0.22, 0.19], [0.81, 0.22], [0.84, 0.75], [0.19, 0.81]];

    function barsUpTo(k) {
      const out = [];
      const killed = new Set();
      for (let j = 0; j <= k && j < m; j++)
        if (steps[j].low !== null) killed.add(steps[j].low);
      for (let j = 0; j <= k && j < m; j++) {
        const st = steps[j];
        if (st.low !== null) {
          out.push({
            dim: S[st.low].dim, birth: S[st.low].t, death: S[st.j].t,
            birthIdx: st.low, deathIdx: st.j, rep: null,
          });
        } else if (!killed.has(j)) {
          out.push({
            dim: S[j].dim, birth: S[j].t,
            death: k === m - 1 ? Infinity : S[k].t,
            birthIdx: j, deathIdx: -1, rep: null,
          });
        }
      }
      return out;
    }
    function narration(k) {
      if (k < 0) return 'Press <strong>step</strong> to process the first column.';
      const st = steps[k], s = S[k], nm = names(s);
      const t2 = (x) => V.fmt(x / 2);
      const kind = ['vertex', 'edge', 'triangle'][s.dim];
      let txt = `<strong>Column ${k + 1}/${m}: ${kind} ${nm}</strong> (arrives at r = ${t2(s.t)}). `;
      if (st.adds.length)
        txt += `Its lowest 1 is in a claimed row, so add the past columns of ${st.adds.map(a => names(S[a])).join(', ')}. `;
      if (st.low === null) {
        if (s.dim === 0) txt += 'A vertex has empty boundary: the column is zero — a component is born.';
        else if (s.dim === 1) txt += `The column cancels to zero: ${nm} closed a <strong>loop — an H₁ class is born.</strong>`;
        else txt += `The column cancels to zero: the four triangles now enclose a hollow tetrahedron — a class in H₂ is born. (Higher floors of the same building; this tour stops here.)`;
      } else {
        const ln = names(S[st.low]);
        if (s.dim === 1) txt += `The lowest 1 lands in row <strong>${ln}</strong>: edge ${nm} merges two islands — the component born at ${ln} dies. Pair (${ln}, ${nm}): an H₀ bar [0, ${t2(s.t)}].`;
        else {
          const len = s.t - S[st.low].t;
          txt += `The lowest 1 lands in row <strong>${ln}</strong>: triangle ${nm} fills the loop born at ${ln}. Pair (${ln}, ${nm}): an H₁ bar [${t2(S[st.low].t)}, ${t2(s.t)}]` +
            (len < 1e-9 ? ' — born and dead in the same instant. Zero-length bars are exactly the bookkeeping the barcode silently drops.' : ' — <strong>the visible loop dies.</strong> This is the bar you saw in §4.');
        }
      }
      return txt;
    }
    function render() {
      $('#step-status').innerHTML = narration(cur);
      bc.set(barsUpTo(cur));
      bc.sweep(cur >= 0 ? S[Math.min(cur, m - 1)].t / 2 : 0);
      planeEnv.draw(); matEnv.draw();
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; $('#step-play').textContent = 'play'; }
    }
    return {
      init() {
        names = (s) => s.verts.map(i => 'abcd'[i]).join('');
        const filt = PH.buildFiltration(pts, { maxDim: 2 });
        S = filt.simplices; m = S.length;

        const key = new Map();
        S.forEach((s, i) => key.set(s.verts.join(','), i));
        rawCol = S.map(s => {
          if (s.dim === 0) return [];
          const col = [];
          for (let d = 0; d < s.verts.length; d++) {
            const face = s.verts.slice(0, d).concat(s.verts.slice(d + 1));
            col.push(key.get(face.join(',')));
          }
          return col.sort((a, b) => a - b);
        });

        steps = [];
        {
          const lowOwner = new Map(), columns = {};
          for (let j = 0; j < m; j++) {
            let col = rawCol[j].slice();
            const adds = [];
            while (col.length) {
              const low = col[col.length - 1];
              const owner = lowOwner.get(low);
              if (owner === undefined) break;
              adds.push(owner);
              col = PH.symdiff(col, columns[owner]);
            }
            const st = { j, adds, finalCol: col, low: null, bars: [] };
            if (col.length) {
              st.low = col[col.length - 1];
              lowOwner.set(st.low, j);
              columns[j] = col;
            }
            steps.push(st);
          }
        }

        planeEnv = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(1);
          const ctx = e.ctx;
          const tris = [], edgesArr = [];
          for (let j = 0; j <= cur; j++) {
            if (S[j].dim === 2) tris.push(S[j].verts);
            if (S[j].dim === 1) edgesArr.push(S[j].verts);
          }
          V.unionTris(e, map, pts, tris, 0.85, C.washTri);
          V.drawEdges(e, map, pts, edgesArr, { color: C.inkSoft, width: 1.6 });
          if (cur >= 0 && cur < m) {
            const s = S[cur];
            ctx.strokeStyle = C.hi; ctx.fillStyle = C.hi; ctx.lineWidth = 3;
            if (s.dim === 1) V.drawEdges(e, map, pts, [s.verts], { color: C.hi, width: 3.4 });
            if (s.dim === 2) {
              ctx.save(); ctx.globalAlpha = 0.35;
              ctx.beginPath();
              ctx.moveTo(map.x(pts[s.verts[0]][0]), map.y(pts[s.verts[0]][1]));
              ctx.lineTo(map.x(pts[s.verts[1]][0]), map.y(pts[s.verts[1]][1]));
              ctx.lineTo(map.x(pts[s.verts[2]][0]), map.y(pts[s.verts[2]][1]));
              ctx.closePath(); ctx.fill(); ctx.restore();
            }
          }
          V.drawPoints(e, map, pts, {
            color: C.ink, r: 4.5,
            highlight: cur >= 0 && S[cur].dim === 0 ? new Set(S[cur].verts) : null,
            hiColor: C.hi,
          });
          ctx.font = '13px ui-monospace, Menlo, monospace';
          ctx.fillStyle = C.inkSoft; ctx.textAlign = 'center';
          pts.forEach((p, i) => {
            const dx = p[0] - 0.5, dy = p[1] - 0.5;
            const L = Math.hypot(dx, dy);
            ctx.fillText('abcd'[i], map.x(p[0] + dx / L * 0.07), map.y(p[1] + dy / L * 0.07) + 4);
          });
        });

        matEnv = V.makeCanvas(auxC, (e) => {
          const C = T.get();
          const ctx = e.ctx;
          const labelW = 44, labelH = 40;
          const cell = Math.max(13, Math.min(21, (e.w - labelW - 10) / m, (e.h - labelH - 22) / m));
          const ox = labelW, oy = labelH;
          ctx.font = '11px ui-monospace, Menlo, monospace';
          for (let i = 0; i < m; i++) {
            const nm = names(S[i]);
            const processed = i <= cur;
            ctx.save();
            ctx.translate(ox + i * cell + cell / 2, oy - 6);
            ctx.rotate(-Math.PI / 3.2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = i === cur ? C.hi : (processed ? C.inkSoft : C.inkFaint);
            ctx.fillText(nm, 0, 0);
            ctx.restore();
            ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
            ctx.fillStyle = C.inkFaint;
            ctx.fillText(nm, ox - 6, oy + i * cell + cell / 2);
          }
          if (cur >= 0 && cur < m) {
            ctx.fillStyle = C.wash;
            ctx.fillRect(ox + cur * cell, oy, cell, m * cell);
          }
          ctx.strokeStyle = C.hair; ctx.lineWidth = 1;
          for (let i = 0; i <= m; i++) {
            ctx.beginPath(); ctx.moveTo(ox, oy + i * cell); ctx.lineTo(ox + m * cell, oy + i * cell); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(ox + i * cell, oy); ctx.lineTo(ox + i * cell, oy + m * cell); ctx.stroke();
          }
          for (let j = 0; j < m; j++) {
            const col = j <= cur ? steps[j].finalCol : rawCol[j];
            const processed = j <= cur;
            for (const i of col) {
              const x = ox + j * cell + cell / 2, y = oy + i * cell + cell / 2;
              const isPivot = processed && steps[j].low === i;
              ctx.fillStyle = processed ? (S[i].dim === 0 ? C.h0 : C.h1) : C.inkFaint;
              ctx.beginPath();
              ctx.arc(x, y, isPivot ? cell * 0.3 : cell * 0.17, 0, 2 * Math.PI);
              ctx.fill();
              if (isPivot) {
                ctx.strokeStyle = C.hi; ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.arc(x, y, cell * 0.4, 0, 2 * Math.PI); ctx.stroke();
              }
            }
          }
          ctx.fillStyle = C.inkFaint;
          ctx.textAlign = 'left'; ctx.font = V.SANS;
          ctx.fillText('rows & columns: simplices in order of arrival · ◉ lowest 1 of a reduced column', ox, oy + m * cell + 14);
        });

        bc = V.Barcode(barsC, { dims: [0, 1], rMax: (S[m - 1].t / 2) * 1.12 });

        $('#step-next').addEventListener('click', () => { stop(); if (cur < m - 1) { cur++; render(); } });
        $('#step-back').addEventListener('click', () => { stop(); if (cur >= 0) { cur--; render(); } });
        $('#step-reset').addEventListener('click', () => { stop(); cur = -1; render(); });
        $('#step-play').addEventListener('click', () => {
          if (timer) { stop(); return; }
          $('#step-play').textContent = 'pause';
          timer = setInterval(() => {
            if (cur < m - 1) { cur++; render(); } else stop();
          }, 1500);
        });
        render();
      },
      enter() {
        planeEnv.enabled = true; matEnv.enabled = true; bc.env.enabled = true;
        render();
      },
      exit() {
        stop();
        planeEnv.enabled = false; matEnv.enabled = false; bc.env.enabled = false;
      },
    };
  })();

  /* ================= §9 sandbox ================= */
  scenes.sandbox = (() => {
    let env, bc, dg, view = 'bars';
    const CAP = 60;
    let seedTick = 0;
    let pts, pers = null, feat = null, r, computeQueued = false;
    return {
      init() {
        pts = ring(77, 24, 0.03);
        const slider = $('#sand-r'), read = $('#sand-read'), counter = $('#sand-count');
        r = parseFloat(slider.value);

        env = V.makeCanvas(planeC, (e) => {
          const C = T.get();
          const map = stageMap(W);
          if (pers) {
            const { edges, tris } = complexAt(pers.filtration, 2 * r);
            V.unionDisks(e, map, pts, r, 0.45, C.wash);
            V.unionTris(e, map, pts, tris, 0.85, C.washTri);
            V.drawEdges(e, map, pts, edges, { color: C.inkFaint, width: 1 });
          }
          V.drawPoints(e, map, pts, { color: C.ink, r: 3.4 });
          drawFeature(e, map, pts, feat);
        });

        bc = V.Barcode(barsC, { dims: [0, 1], rMax: 0.3 });
        dg = V.Diagram(barsC, { rMax: 0.3 });
        dg.env.enabled = false;
        const onHover = (bar) => { feat = pers ? featureOf(bar, pers.filtration) : null; env.draw(); };
        bc.onHover = onHover; dg.onHover = onHover;

        const recompute = () => {
          if (computeQueued) return;
          computeQueued = true;
          requestAnimationFrame(() => {
            computeQueued = false;
            pers = pts.length ? PH.persistence(pts) : null;
            feat = null;
            bc.set(pers ? pers.bars : []);
            dg.set(pers ? pers.bars : []);
            bc.sweep(r);
            counter.textContent = `${pts.length} / ${CAP} points${pts.length >= CAP ? ' — full' : ''}`;
            env.draw();
          });
        };
        this._recompute = recompute;

        $$('.ctl[data-scene="sandbox"] [data-preset]').forEach(btn => btn.addEventListener('click', () => {
          seedTick++;
          const k = btn.dataset.preset;
          if (k === 'ring') pts = ring(77 + seedTick, 24, 0.03);
          else if (k === 'eight') pts = ring(50 + seedTick, 14, 0.02, W / 2 - 0.24, 0.5, 0.19)
            .concat(ring(90 + seedTick, 13, 0.02, W / 2 + 0.22, 0.5, 0.16));
          else if (k === 'clusters') pts = blob(30 + seedTick, 10, 0.4, 0.35, 0.09)
            .concat(blob(60 + seedTick, 10, 1.15, 0.6, 0.09))
            .concat(scatter(80 + seedTick, 3));
          else if (k === 'random') pts = scatter(10 + seedTick, 28);
          else pts = [];
          recompute();
        }));

        bindChips($$('.ctl[data-scene="sandbox"] [data-view]'), (ch) => {
          view = ch.dataset.view === 'diagram' ? 'diagram' : 'bars';
          bc.env.enabled = view === 'bars';
          dg.env.enabled = view === 'diagram';
          (view === 'diagram' ? dg : bc).redraw();
        });

        slider.addEventListener('input', () => {
          r = parseFloat(slider.value);
          read.textContent = 'r = ' + V.fmt(r);
          bc.sweep(r);
          env.draw();
        });
        recompute();
      },
      enter() {
        env.enabled = true;
        (view === 'diagram' ? dg : bc).env.enabled = true;
      },
      exit() {
        env.enabled = false;
        bc.env.enabled = false; dg.env.enabled = false;
      },
      pdown(ev) {
        const rect = planeC.getBoundingClientRect();
        const map = stageMap(W);
        const wx = map.fromX(ev.clientX - rect.left), wy = map.fromY(ev.clientY - rect.top);
        let hit = -1, bd = map.d ? 12 / map.s : 0.03;
        pts.forEach((p, i) => {
          const d = Math.hypot(p[0] - wx, p[1] - wy);
          if (d < bd) { bd = d; hit = i; }
        });
        if (hit >= 0) pts.splice(hit, 1);
        else if (pts.length < CAP && wx > -0.02 && wx < W + 0.02 && wy > -0.02 && wy < 1.02)
          pts.push([wx, wy]);
        else return;
        env.draw();
        this._recompute();
      },
    };
  })();

  /* ================= scene manager ================= */

  const SCENES = [
    { key: 'top', num: '', title: 'The Shape of a Point Cloud' },
    { key: 'shape', num: '1', title: 'A cloud with a secret' },
    { key: 'grow', num: '2', title: 'Inflate everything' },
    { key: 'merge', num: '3', title: 'Births and deaths' },
    { key: 'loops', num: '4', title: 'Loops' },
    { key: 'noise', num: '5', title: 'Trust' },
    { key: 'rips', num: '6', title: 'Triangles, not disks' },
    { key: 'chain', num: '7', title: 'Where the linear algebra lives' },
    { key: 'stepper', num: '8', title: 'The algorithm' },
    { key: 'sandbox', num: '9', title: 'Your turn' },
    { key: 'coda', num: '∞', title: 'Coda' },
  ];
  let curIdx = -1, cur = null;

  // top nav: numbered shortcuts (skip ahead if you know stuff)
  const nav = $('#nav');
  SCENES.forEach((sc, i) => {
    if (!sc.num) return;
    const b = document.createElement('button');
    b.className = 'navnum';
    b.dataset.key = sc.key;
    b.textContent = sc.num;
    const label = (sc.num === '∞' ? '' : '§' + sc.num + ' · ') + sc.title;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => show(i));
    nav.appendChild(b);
  });

  function show(i) {
    i = Math.max(0, Math.min(SCENES.length - 1, i));
    if (i === curIdx) return;
    if (cur && cur.exit) cur.exit();
    curIdx = i;
    const sc = SCENES[i];
    document.body.dataset.scene = sc.key;
    $$('#prose > section').forEach(s => s.classList.toggle('active', s.dataset.scene === sc.key));
    $$('#ctlbar .ctl').forEach(c => c.classList.toggle('active', c.dataset.scene === sc.key));
    const def = scenes[sc.key];
    if (!def._inited) { def.init(); def._inited = true; }
    if (def.enter) def.enter();
    cur = def;

    $$('#nav .navnum').forEach(b => b.classList.toggle('active', b.dataset.key === sc.key));
    $('#now').textContent = sc.num ? (sc.num === '∞' ? sc.title : '§ ' + sc.num + ' · ' + sc.title) : '';
    $('#prev').disabled = i === 0;
    $('#next').disabled = i === SCENES.length - 1;
    const nxt = SCENES[i + 1];
    $('#next-label').textContent = nxt ? 'next: ' + (nxt.num && nxt.num !== '∞' ? '§' + nxt.num + ' · ' : '') + nxt.title : '';
    $('#prose').scrollTop = 0;
    if (location.hash.slice(1) !== sc.key) history.replaceState(null, '', '#' + sc.key);
    document.title = (sc.key === 'top'
      ? 'The Shape of a Point Cloud — an interactive tour of persistent homology'
      : (sc.num && sc.num !== '∞' ? '§' + sc.num + ' · ' : '') + sc.title + ' — The Shape of a Point Cloud');
  }

  // pointer routing: the background canvas belongs to the active scene
  planeC.addEventListener('pointerdown', (e) => { if (cur && cur.pdown) cur.pdown(e); });
  planeC.addEventListener('pointermove', (e) => { if (cur && cur.pmove) cur.pmove(e); });
  planeC.addEventListener('pointerup', (e) => { if (cur && cur.pup) cur.pup(e); });

  $('#begin').addEventListener('click', () => show(1));
  $('#prev').addEventListener('click', () => show(curIdx - 1));
  $('#next').addEventListener('click', () => show(curIdx + 1));

  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); show(curIdx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(curIdx - 1); }
    else if (/^[0-9]$/.test(e.key)) {
      if (e.key === '0') { show(0); return; }
      const j = SCENES.findIndex(s => s.num === e.key);
      if (j >= 0) show(j);
    }
  });

  // deep links: #merge, #sandbox, … (?s=merge also works)
  function fromLocation() {
    const q = new URLSearchParams(location.search).get('s');
    const k = location.hash.slice(1) || q || 'top';
    const j = SCENES.findIndex(s => s.key === k);
    show(j >= 0 ? j : 0);
  }
  addEventListener('hashchange', fromLocation);
  fromLocation();
})();
