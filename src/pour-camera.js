export const MIN_ZOOM = .75;
export const MAX_ZOOM = 2.4;

export const clampZoom = (zoom) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
export const pinchZoom = (startZoom, startDistance, distance) =>
  clampZoom(startZoom * distance / Math.max(1, startDistance));
export const orbitRadians = (horizontalPixels) => -horizontalPixels * .009;
