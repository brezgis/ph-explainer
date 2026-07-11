# The Shape of a Point Cloud

A full-screen, click-through interactive tour of **persistent homology** for
readers with a linear-algebra background — no topology required. The widgets
*are* the page: every scene draws on one borderless background canvas, with
the text floating on top. Pure vanilla HTML/CSS/JS, no build step, no
dependencies; every barcode is computed in the browser by a ℤ/2
boundary-matrix reduction.

Navigate with the numbered shortcuts in the top bar, the arrows at the bottom
right, or the ← → keys. Sections deep-link: `#merge`, `#sandbox`, ….

## Tour

1. **A cloud with a secret** — why statistics can't say "there is a hole"
2. **Inflate everything** — union of disks, sweeping the radius
3. **Births and deaths** — the H₀ barcode from merging components
4. **Loops** — the H₁ barcode; long bars are features, short bars are noise
5. **Trust** — shake the data; barcode vs. persistence-diagram views
6. **Triangles, not disks** — the Vietoris–Rips complex
7. **How a matrix notices a hole** — build chains by hand; cycles = null space
8. **The algorithm** — a 14-column matrix-reduction stepper on four points
9. **The sandbox** — draw your own cloud, live persistence up to 60 points

## Files

```
index.html      all eleven scenes: prose + controls
style.css       design tokens (light + dark), full-screen layout
js/engine.js    persistence engine: Rips filtration, reduction, Betti checks
js/viz.js       canvas plumbing, barcode + diagram components
js/app.js       the scene manager and the widgets
```

Radii convention: the engine works in Rips scale ε (edge appears when
`dist ≤ ε`); every UI shows the disk radius `r = ε/2`.

There is also a blog-post edition with a subset of the widgets embedded in
prose: [What is Persistent Homology?](https://brezgis.com/blog/what-is-persistent-homology.html)

To serve locally: `python3 -m http.server` and open `http://localhost:8000`.
