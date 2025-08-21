/**
 * Navigation utilities for PDF sheet bounding boxes
 * Contains extracted functions from the PDF SVG editor
 */

import { BoundingBox, findBoundingBoxInSheet as findBoundingBoxInSheetAPI, searchBoundingBoxAcrossSheets as searchBoundingBoxAcrossSheetsAPI } from './index';

// Define the correct type for the API response
type SearchResultAPI = { box: BoundingBox, sheetIndex: number } | null;

/**
 * Find bounding box by code in a specific sheet
 */
export async function findBoundingBoxInSheet(sheetIndex: number, code: string): Promise<BoundingBox | null> {
  return findBoundingBoxInSheetAPI(sheetIndex, code);
}

/**
 * Search for bounding box by code across all sheets
 */
export async function searchBoundingBoxAcrossSheets(code: string): Promise<{ sheetIndex: number, boundingBox: BoundingBox } | null> {
  const result = await searchBoundingBoxAcrossSheetsAPI(code) as SearchResultAPI;
  if (result) {
    // Properly map from API response to our expected structure
    return { 
      sheetIndex: result.sheetIndex, 
      boundingBox: result.box 
    };
  }
  return null;
}

/**
 * Navigate to sheet and zoom to bounding box
 */
export function navigateToSheetAndZoom(
  onNavigateToSheet: ((sheetIndex: number, targetBoundingBox?: BoundingBox) => void) | undefined,
  sheetIndex: number, 
  boundingBox?: BoundingBox
) {
  if (onNavigateToSheet) {
    // Pass the target bounding box to the parent component
    if (boundingBox) {
      onNavigateToSheet(sheetIndex, boundingBox);
    } else {
      onNavigateToSheet(sheetIndex);
    }
  }
}

/**
 * Handle sheet code click - navigate to the referenced sheet
 */
export async function handleSheetCodeClick(
  code: string,
  sheetMappings: any[],
  onNavigateToSheet: ((sheetIndex: number, targetBoundingBox?: BoundingBox) => void) | undefined
) {
  const sheet = sheetMappings.find(s => s.code === code);
  if (sheet && onNavigateToSheet) {
    
    // Check if there's a bounding box in the target sheet that matches this code
    const foundBox = await findBoundingBoxInSheet(sheet.index, code);
    if (foundBox) {
      navigateToSheetAndZoom(onNavigateToSheet, sheet.index, foundBox);
    } else {
      // No matching bounding box, just navigate normally
      onNavigateToSheet(sheet.index);
    }
  } else {
    console.warn(`[DEBUG] Sheet not found for code: ${code}`);
  }
}

/**
 * Handle SF pattern click - search for and navigate to the referenced sheet
 */
export async function handleSfPatternClick(
  sfText: string,
  onNavigateToSheet: ((sheetIndex: number, targetBoundingBox?: BoundingBox) => void) | undefined
) {
  
  // Search for bounding box with this SF code across all sheets
  const result = await searchBoundingBoxAcrossSheets(sfText);
  if (result) {
    navigateToSheetAndZoom(onNavigateToSheet, result.sheetIndex, result.boundingBox);
  } else {
  }
}

/**
 * Handle CW pattern click - search for and navigate to the referenced sheet
 */
export async function handleCwPatternClick(
  cwText: string,
  onNavigateToSheet: ((sheetIndex: number, targetBoundingBox?: BoundingBox) => void) | undefined
) {
  
  // Search for bounding box with this CW code across all sheets
  const result = await searchBoundingBoxAcrossSheets(cwText);
  if (result) {
    navigateToSheetAndZoom(onNavigateToSheet, result.sheetIndex, result.boundingBox);
  } else {
  }
}
