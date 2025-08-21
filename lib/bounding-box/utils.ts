/**
 * Utility functions for bounding box calculations and transformations
 */

import { BoundingBox } from './types';

// Export navigation utilities but NOT scanning to avoid circular dependency
export * from './navigation';

/**
 * Transforms pattern coordinates to SVG coordinates
 */
export function transformPatternCoordinates(
  patternCoords: any, 
  svgDimensions?: { width: number; height: number }
) {
  if (!svgDimensions) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // Get coordinates from pattern - handle different input formats
  let x1, y1, x2, y2;
  
  try {
    if (Array.isArray(patternCoords)) {
      // Handle array format: [y1, x1, y2, x2]
      [y1, x1, y2, x2] = patternCoords;
    } else if (patternCoords && typeof patternCoords === 'object') {
      // Handle object format
      if (patternCoords.x !== undefined && patternCoords.y !== undefined) {
        // Format: {x, y, width?, height?}
        x1 = patternCoords.x;
        y1 = patternCoords.y;
        x2 = patternCoords.x + (patternCoords.width || 0);
        y2 = patternCoords.y + (patternCoords.height || 0);
      } else if (patternCoords.x1 !== undefined) {
        // Format: {x1, y1, x2, y2}
        x1 = patternCoords.x1;
        y1 = patternCoords.y1;
        x2 = patternCoords.x2;
        y2 = patternCoords.y2;
      } else {
        console.error('Unknown coordinate format:', patternCoords);
        return { x: 0, y: 0, width: 0, height: 0 };
      }
    } else {
      console.error('Invalid patternCoords format:', patternCoords);
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  } catch (error) {
    console.error('Error parsing pattern coordinates:', error, patternCoords);
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  // Calculate width and height from coordinates
  const width = Math.abs(y2 - y1);
  const height = Math.abs(x2 - x1);
  return {
    x: (svgDimensions.width - x1 + svgDimensions.width - x2) / 2,
    y: (y1 + y2) / 2,
    width: width,
    height: height
  };
}

/**
 * Checks if a pattern is within a bounding box
 */
export function isPatternWithinBoundingBox(
  patternCoords: any, 
  boundingBox: BoundingBox,
  transformFn: (coords: any, svgDimensions?: { width: number; height: number }) => { x: number; y: number; width: number; height: number }
) {
  const coords = transformFn(patternCoords);
  const centerX = coords.x + coords.width / 2;
  const centerY = coords.y + coords.height / 2;
  
  return centerX >= boundingBox.x && 
         centerX <= boundingBox.x + boundingBox.width &&
         centerY >= boundingBox.y && 
         centerY <= boundingBox.y + boundingBox.height;
}

/**
 * Calculate visible bounds based on stage configuration
 */
export function getVisibleBounds(
  stage: { x: number; y: number; scale: number }, 
  stageSize: { width: number; height: number }
) {
  const padding = 100; // Extra padding to avoid boxes popping in/out
  return {
    left: (-stage.x / stage.scale) - padding,
    top: (-stage.y / stage.scale) - padding,
    right: (-stage.x + stageSize.width) / stage.scale + padding,
    bottom: (-stage.y + stageSize.height) / stage.scale + padding
  };
}

/**
 * Filter bounding boxes to only show those that are visible in the current view
 */
export function getVisibleBoxes(
  boundingBoxes: BoundingBox[], 
  bounds: { left: number; top: number; right: number; bottom: number }
) {
  return boundingBoxes.filter(box => {
    return !(box.x + box.width < bounds.left || 
             box.x > bounds.right ||
             box.y + box.height < bounds.top || 
             box.y > bounds.bottom);
  });
}
