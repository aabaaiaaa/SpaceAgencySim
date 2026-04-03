// PixiJS rendering layer.
// Consumes game state snapshots and renders them to the WebGL canvas.
// Rendering is strictly one-way: it reads state but never modifies it directly.

import * as PIXI from 'pixi.js';

declare global {
  interface Window {
    __pixiApp?: PIXI.Application;
  }
}

let app: PIXI.Application | null = null;

/**
 * Initialize the PixiJS Application and attach it to the provided canvas.
 */
export async function initRenderer(canvas: HTMLCanvasElement): Promise<void> {
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

}

/**
 * Return the active PixiJS Application instance.
 */
export function getApp(): PIXI.Application {
  if (!app) throw new Error('Renderer not initialized — call initRenderer() first.');
  return app;
}
