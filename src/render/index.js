// PixiJS rendering layer.
// Consumes game state snapshots and renders them to the WebGL canvas.
// Rendering is strictly one-way: it reads state but never modifies it directly.

import * as PIXI from 'pixi.js';

/** @type {PIXI.Application | null} */
let app = null;

/**
 * Initialize the PixiJS Application and attach it to the provided canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<void>}
 */
export async function initRenderer(canvas) {
  app = new PIXI.Application();

  await app.init({
    canvas,
    resizeTo: window,
    background: '#0a0a1a',
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // Expose for e2e testing (Playwright can access PIXI stage via window.__pixiApp)
  window.__pixiApp = app;

  console.log('[Renderer] PixiJS initialized', PIXI.VERSION);
}

/**
 * Return the active PixiJS Application instance.
 * @returns {PIXI.Application}
 */
export function getApp() {
  if (!app) throw new Error('Renderer not initialized — call initRenderer() first.');
  return app;
}
