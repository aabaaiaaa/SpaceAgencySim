/**
 * previewLayout.ts — Pure bounding-box and scale computation for rocket previews.
 *
 * Extracted from rocketCardUtil.ts so the math is testable without DOM/canvas.
 *
 * @module previewLayout
 */

/** A rectangle with position and size. */
export interface PartRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Dimensions and padding for the preview area. */
export interface PreviewDimensions {
  width: number;
  height: number;
  padding: number;
}

/** Computed layout values for rendering a rocket preview. */
export interface PreviewLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Compute the scale and offset needed to fit a set of part rectangles
 * into a preview area of the given dimensions.
 *
 * `offsetX` and `offsetY` represent the centre of the preview area,
 * while `scale` converts from world-space to preview-space. To draw a
 * part at world position `(px, py)`:
 *
 *     screenX = offsetX + (px - midX) * scale
 *     screenY = offsetY - (py - midY) * scale
 *
 * where `midX`/`midY` are the centre of the bounding box (captured
 * internally — callers use `offsetX`/`offsetY` directly).
 *
 * Returns `null` if the input array is empty.
 */
export function computePreviewLayout(
  parts: readonly PartRect[],
  dims: PreviewDimensions,
): (PreviewLayout & { midX: number; midY: number }) | null {
  if (parts.length === 0) return null;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of parts) {
    const hw = p.width / 2;
    const hh = p.height / 2;
    minX = Math.min(minX, p.x - hw);
    maxX = Math.max(maxX, p.x + hw);
    minY = Math.min(minY, p.y - hh);
    maxY = Math.max(maxY, p.y + hh);
  }

  const rocketW = maxX - minX;
  const rocketH = maxY - minY;

  const drawW = dims.width - dims.padding * 2;
  const drawH = dims.height - dims.padding * 2;
  const scale = Math.min(drawW / Math.max(rocketW, 1), drawH / Math.max(rocketH, 1));

  const offsetX = dims.width / 2;
  const offsetY = dims.height / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  return { scale, offsetX, offsetY, midX, midY };
}
