# canvas-audit-core

> Driver-agnostic measurement engine for canvas, WebGL and display-quality audits. Bring your own browser.

## Features
- **Pure Evaluation & Analysis**: Pure calculation functions over raw page measurements (no DOM/browser dependency during judgment).
- **DPR Sharpness**: Identifies blurry under-sampled rendering and oversized GPU memory buffers.
- **Frame Pacing & Jitter**: Statistical analysis of frame intervals, dropped frames, P95 stutter, and GPU readback stalls.
- **Ergonomics & WCAG 2.2**: Layout overflow and touch target compliance against WCAG 2.2 AA (24px) and Apple/Material HIG (44px).
- **WebGL Context Resilience**: Assesses recovery handlers for `webglcontextlost` and `webglcontextrestored`.

## License
MIT
