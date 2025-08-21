/**
 * Bounding box module index
 * This file exports all the bounding box related functionality
 */

// Export types
export * from './types';

// Export API services - explicit to avoid name conflicts
export { 
  loadBoundingBoxes,
  saveBoundingBoxes,
  updateBoundingBox,
  findBoundingBoxInSheet as findBoundingBoxInSheetAPI,
  searchBoundingBoxAcrossSheets as searchBoundingBoxAcrossSheetsAPI,
  searchIntegerPatternAcrossSheets
} from './api';

// Export helpers
export * from './helpers';

// Export navigation utilities
export * from './navigation';

// Export utils and scanning functions explicitly to avoid conflicts
export { 
  transformPatternCoordinates,
  getVisibleBounds,
  getVisibleBoxes
} from './utils';

export {
  scanBoundingBox,
  scanBoundingBoxById
} from './scanning';

// Export the isPatternWithinBoundingBox only from utils (the original source)
export { isPatternWithinBoundingBox } from './utils';
