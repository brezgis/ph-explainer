/* engine.js — persistent homology over Z/2 for 2-D point clouds.
 *
 * Vietoris–Rips filtration up to dimension 2 (optionally 3), reduced with the
 * standard column algorithm. Times are Rips scale ε = pairwise distance; the
 * page draws disks of radius r = ε/2, so the UI divides every time by 2.
 *
 * Exposed as window.PH in the browser and module.exports under node.
 */
(function () {
  'use strict';

  // ---------- utilities ----------

  function dist(a, b) {
    const dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  // mulberry32 — tiny seeded RNG so presets are reproducible
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // symmetric difference of two sorted int arrays (Z/2 column addition)
  function symdiff(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else if (a[i] < b[j]) out.push(a[i++]);
      else out.push(b[j++]);
    }
    while (i < a.length) out.push(a[i++]);
    while (j < b.length) out.push(b[j++]);
    return out;
  }

  // ---------- filtration ----------

  // Full Rips filtration on `points` (array of [x,y]) up to maxDim.
  // Returns simplices sorted by (time, dim); each is
  //   { verts, dim, t, idx }  with idx = position in filtration order.
  function buildFiltration(points, opts) {
    opts = opts || {};
    const maxDim = opts.maxDim === undefined ? 2 : opts.maxDim;
    const n = points.length;
    const simplices = [];

    const D = []; // condensed distance lookup
    for (let i = 0; i < n; i++) {
      D.push(new Float64Array(n));
      simplices.push({ verts: [i], dim: 0, t: 0 });
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist(points[i], points[j]);
        D[i][j] = d; D[j][i] = d;
        if (maxDim >= 1) simplices.push({ verts: [i, j], dim: 1, t: d });
      }
    }
    if (maxDim >= 2) {
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          for (let k = j + 1; k < n; k++) {
            const t = Math.max(D[i][j], D[i][k], D[j][k]);
            simplices.push({ verts: [i, j, k], dim: 2, t });
          }
    }
    if (maxDim >= 3) {
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++)
          for (let k = j + 1; k < n; k++)
            for (let l = k + 1; l < n; l++) {
              const t = Math.max(D[i][j], D[i][k], D[i][l], D[j][k], D[j][l], D[k][l]);
              simplices.push({ verts: [i, j, k, l], dim: 3, t });
            }
    }

    // faces must precede cofaces: sort by time, then dimension.
    simplices.sort((a, b) => (a.t - b.t) || (a.dim - b.dim));
    simplices.forEach((s, i) => { s.idx = i; });
    return { points, simplices, n };
  }

  // ---------- persistence (standard reduction) ----------

  // Returns { bars, filtration }. Bars:
  //   { dim, birth, death, birthIdx, deathIdx, rep }
  // death = Infinity for essential classes. rep (finite dim-1 bars only) is a
  // list of vertex pairs [i,j] — the edges of a cycle representing the class:
  // the reduced column of the killing triangle, which is a cycle whose latest
  // edge is the birth edge.
  function persistence(points, opts) {
    const filt = buildFiltration(points, opts);
    const S = filt.simplices;
    const m = S.length;

    // key vertices -> filtration index, to build boundary columns
    const key = new Map();
    for (let i = 0; i < m; i++) key.set(S[i].verts.join(','), i);

    const boundaryOf = (s) => {
      if (s.dim === 0) return [];
      const col = [];
      const v = s.verts;
      for (let drop = 0; drop < v.length; drop++) {
        const face = v.slice(0, drop).concat(v.slice(drop + 1));
        col.push(key.get(face.join(',')));
      }
      col.sort((a, b) => a - b);
      return col;
    };

    const lowOwner = new Map();  // pivot row -> column index that owns it
    const columns = new Array(m); // reduced nonzero columns
    const paired = new Uint8Array(m);
    const bars = [];

    for (let j = 0; j < m; j++) {
      let col = boundaryOf(S[j]);
      while (col.length) {
        const low = col[col.length - 1];
        const owner = lowOwner.get(low);
        if (owner === undefined) break;
        col = symdiff(col, columns[owner]);
      }
      if (col.length) {
        const low = col[col.length - 1];
        lowOwner.set(low, j);
        columns[j] = col;
        paired[low] = 1; paired[j] = 1;
        const birthS = S[low];
        bars.push({
          dim: birthS.dim, birth: birthS.t, death: S[j].t,
          birthIdx: low, deathIdx: j,
          rep: birthS.dim === 1 ? col.map(i => S[i].verts) : null,
        });
      }
      // col empty -> S[j] creates a class; paired later or essential
    }
    for (let j = 0; j < m; j++) {
      if (!paired[j] && !columns[j]) {
        bars.push({
          dim: S[j].dim, birth: S[j].t, death: Infinity,
          birthIdx: j, deathIdx: -1, rep: null,
        });
      }
    }
    bars.sort((a, b) => (a.dim - b.dim) || (a.birth - b.birth) || (a.death - b.death));
    return { bars, filtration: filt };
  }

  // ---------- helpers for the page ----------

  // connected component of vertex v using edges with t < tMax (strict)
  function componentAt(filtration, v, tMax) {
    const n = filtration.n;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const s of filtration.simplices) {
      if (s.t >= tMax) break;
      if (s.dim === 1) {
        const a = find(s.verts[0]), b = find(s.verts[1]);
        if (a !== b) parent[a] = b;
      }
    }
    const root = find(v), out = [];
    for (let i = 0; i < n; i++) if (find(i) === root) out.push(i);
    return out;
  }

  // ---------- independent verification (tests only) ----------

  // Betti numbers of the Rips complex at scale t by Gaussian elimination:
  // b0 = n - rank ∂1,  b1 = (E - rank ∂1) - rank ∂2.
  function betti(points, t) {
    const n = points.length;
    const edges = [], eKey = new Map();
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (dist(points[i], points[j]) <= t) {
          eKey.set(i + ',' + j, edges.length);
          edges.push([i, j]);
        }
    const tris = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let k = j + 1; k < n; k++)
          if (eKey.has(i + ',' + j) && eKey.has(i + ',' + k) && eKey.has(j + ',' + k))
            tris.push([i, j, k]);

    const rank = (cols) => {
      // cols: array of sorted int arrays over Z/2
      const pivots = new Map();
      let r = 0;
      for (let col of cols) {
        while (col.length) {
          const low = col[col.length - 1];
          const p = pivots.get(low);
          if (p === undefined) { pivots.set(low, col); r++; break; }
          col = symdiff(col, p);
        }
      }
      return r;
    };

    const d1 = edges.map(e => [e[0], e[1]]);
    const d2 = tris.map(tr => {
      const c = [
        eKey.get(tr[0] + ',' + tr[1]),
        eKey.get(tr[0] + ',' + tr[2]),
        eKey.get(tr[1] + ',' + tr[2]),
      ];
      c.sort((a, b) => a - b);
      return c;
    });
    const r1 = rank(d1), r2 = rank(d2);
    return [n - r1, edges.length - r1 - r2];
  }

  // ---------- presets (unit square, y down is fine — pure geometry) ----------

  function noisyRing(seed, n, noise, cx, cy, R) {
    const r = rng(seed), pts = [];
    cx = cx === undefined ? 0.5 : cx;
    cy = cy === undefined ? 0.5 : cy;
    R = R === undefined ? 0.3 : R;
    n = n || 22; noise = noise === undefined ? 0.035 : noise;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI + (r() - 0.5) * 0.35;
      pts.push([
        cx + Math.cos(a) * (R + (r() - 0.5) * 2 * noise),
        cy + Math.sin(a) * (R + (r() - 0.5) * 2 * noise),
      ]);
    }
    return pts;
  }

  function figureEight(seed, nPer, noise) {
    nPer = nPer || 14;
    return noisyRing(seed, nPer, noise, 0.30, 0.5, 0.17)
      .concat(noisyRing((seed || 1) + 7, nPer, noise, 0.68, 0.5, 0.15));
  }

  function twoClusters(seed, nPer, spread) {
    const r = rng(seed), pts = [];
    nPer = nPer || 11; spread = spread === undefined ? 0.07 : spread;
    const centers = [[0.28, 0.42], [0.72, 0.58]];
    for (const [cx, cy] of centers)
      for (let i = 0; i < nPer; i++) {
        const a = r() * 2 * Math.PI, d = Math.sqrt(r()) * spread;
        pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d]);
      }
    return pts;
  }

  function uniform(seed, n) {
    const r = rng(seed), pts = [];
    for (let i = 0; i < (n || 26); i++)
      pts.push([0.08 + r() * 0.84, 0.10 + r() * 0.80]);
    return pts;
  }

  const PH = {
    dist, rng, symdiff,
    buildFiltration, persistence, componentAt, betti,
    presets: { noisyRing, figureEight, twoClusters, uniform },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PH;
  if (typeof window !== 'undefined') window.PH = PH;
})();
