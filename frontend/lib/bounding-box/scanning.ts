/**
 * Scanning utilities for PDF sheet bounding boxes
 * Contains extracted scan functions from the PDF SVG editor
 */

import { BoundingBox } from './types';
import { isPatternWithinBoundingBox } from './utils';

/**
 * Scan a bounding box for patterns
 */
export async function scanBoundingBox(
  selectedBox: string | null,
  boundingBoxes: BoundingBox[],
  sheetCodes: any[],
  sfPatterns: any[],
  cwPatterns: any[],
  isPatternWithinBoundingBox: (patternCoords: any, boundingBox: BoundingBox) => boolean,
  setIsScanning: (isScanning: boolean) => void,
  setScannedButtons: (buttons: Set<string>) => void,
  setVisiblePatternButtons: (buttons: Set<string>) => void,
  transformPatternCoordinates: (coords: any, svgDimensions?: { width: number; height: number }) => { x: number, y: number, width: number, height: number }
) {
  if (!selectedBox) return;
  
  const selectedBoxData = boundingBoxes.find(box => box.id === selectedBox);
  if (!selectedBoxData) return;
  
  setIsScanning(true);
  setScannedButtons(new Set<string>());
  setVisiblePatternButtons(new Set<string>());
  
  // Collect all patterns within the bounding box
  const patternsInBox: Array<{id: string, x: number, type: string}> = [];
  
  // Check sheet codes
  sheetCodes.forEach((pattern) => {
    if (isPatternWithinBoundingBox(pattern.coordinates, selectedBoxData)) {
      const coords = transformPatternCoordinates(pattern.coordinates);
      patternsInBox.push({
        id: `sheet-code-${pattern.index}-${pattern.text}`,
        x: coords.x + coords.width / 2,
        type: 'sheet'
      });
    }
  });
  
  // Check SF patterns
  sfPatterns.forEach((pattern) => {
    if (isPatternWithinBoundingBox(pattern.coordinates, selectedBoxData)) {
      const coords = transformPatternCoordinates(pattern.coordinates);
      patternsInBox.push({
        id: `sf-pattern-${pattern.index}-${pattern.text}`,
        x: coords.x + coords.width / 2,
        type: 'sf'
      });
    }
  });
  
  // Check CW patterns
  cwPatterns.forEach((pattern) => {
    if (isPatternWithinBoundingBox(pattern.coordinates, selectedBoxData)) {
      const coords = transformPatternCoordinates(pattern.coordinates);
      patternsInBox.push({
        id: `cw-pattern-${pattern.index}-${pattern.text}`,
        x: coords.x + coords.width / 2,
        type: 'cw'
      });
    }
  });
  
  // Sort patterns by x coordinate (left to right)
  patternsInBox.sort((a, b) => a.x - b.x);
  
  // Animate scanning from left to right
  const scannedButtonsSet = new Set<string>();
  const visibleButtonsSet = new Set<string>();
  
  for (let i = 0; i < patternsInBox.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between each reveal
    
    scannedButtonsSet.add(patternsInBox[i].id);
    visibleButtonsSet.add(patternsInBox[i].id);
    
    setScannedButtons(new Set(scannedButtonsSet));
    setVisiblePatternButtons(new Set(visibleButtonsSet));
  }
  
  setIsScanning(false);
}

/**
 * Scan a specific bounding box by ID
 */
export function scanBoundingBoxById(
  boxId: string,
  boundingBoxes: BoundingBox[],
  sheetCodes: any[],
  sfPatterns: any[],
  cwPatterns: any[],
  isPatternWithinBoundingBox: (patternCoords: any, boundingBox: BoundingBox) => boolean,
  transformPatternCoordinates: (coords: any, svgDimensions?: { width: number; height: number }) => { x: number, y: number, width: number, height: number },
  visiblePatternButtons: Set<string>,
  setVisiblePatternButtons: (buttons: Set<string>) => void
) {
  const boxData = boundingBoxes.find(box => box.id === boxId);
  if (!boxData) {
    return;
  }
  
  
  // Collect all patterns within the bounding box
  const patternsInBox: Array<{id: string, x: number, type: string}> = [];
  
  // Check sheet codes
  sheetCodes.forEach((pattern) => {
    if (isPatternWithinBoundingBox(pattern.coordinates, boxData)) {
      const coords = transformPatternCoordinates(pattern.coordinates);
      const patternId = `sheet-code-${pattern.index}-${pattern.text}`;
      patternsInBox.push({
        id: patternId,
        x: coords.x + coords.width / 2,
        type: 'sheet'
      });
    }
  });
  
  // Check SF patterns
  sfPatterns.forEach((pattern) => {
    if (isPatternWithinBoundingBox(pattern.coordinates, boxData)) {
      const coords = transformPatternCoordinates(pattern.coordinates);
      const patternId = `sf-pattern-${pattern.index}-${pattern.text}`;
      patternsInBox.push({
        id: patternId,
        x: coords.x + coords.width / 2,
        type: 'sf'
      });
    }
  });
  
  // Check CW patterns
  cwPatterns.forEach((pattern) => {
    if (isPatternWithinBoundingBox(pattern.coordinates, boxData)) {
      const coords = transformPatternCoordinates(pattern.coordinates);
      const patternId = `cw-pattern-${pattern.index}-${pattern.text}`;
      patternsInBox.push({
        id: patternId,
        x: coords.x + coords.width / 2,
        type: 'cw'
      });
    }
  });
  
  // Add all patterns to visible set immediately (no animation)
  const newVisiblePatterns = new Set(visiblePatternButtons);
  patternsInBox.forEach(pattern => {
    newVisiblePatterns.add(pattern.id);
  });
  
  setVisiblePatternButtons(newVisiblePatterns);
}
