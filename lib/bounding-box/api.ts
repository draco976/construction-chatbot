/**
 * Service functions for bounding box API operations
 */

import { BoundingBox, BoundingBoxFile, IntegerPatternSearchResult } from './types';

/**
 * Convert sheetId format: "page_001" -> 1, "325" -> 325, "1" -> 1
 */
function parseSheetId(sheetId: string): number {
  if (sheetId.startsWith('page_')) {
    return parseInt(sheetId.replace('page_', ''));
  }
  return parseInt(sheetId);
}

/**
 * Load bounding boxes for a specific sheet
 */
export async function loadBoundingBoxes(sheetId: string): Promise<BoundingBoxFile | null> {
  try {
    // Handle both "page_001" and "1" formats
    const numericId = parseSheetId(sheetId);
    const response = await fetch(`http://localhost:8080/api/sheets/${numericId}/bounding-boxes`);
    
    if (response.ok) {
      const data = await response.json();
      return data;
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Save bounding boxes for a specific sheet
 */
export async function saveBoundingBoxes(
  sheetId: string, 
  boundingBoxes: BoundingBox[], 
  svgDimensions: { width: number; height: number }
): Promise<boolean> {
  try {
    const numericId = parseSheetId(sheetId);
    const data = {
      sheet_id: sheetId,
      document_info: {
        pdf_name: `${sheetId}.pdf`,
        page_number: 1,
        svg_dimensions: svgDimensions
      },
      bounding_boxes: boundingBoxes
    };

    
    // Save to the bounding-boxes API endpoint using numeric ID
    const response = await fetch(`http://localhost:8080/api/sheets/${numericId}/bounding-boxes`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to save: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    return true;
    
  } catch (error) {
    console.error('Error saving bounding boxes:', error);
    return false;
  }
}

/**
 * Fetch SVG content for a specific sheet
 */
export async function getSheetSvgContent(sheetId: string): Promise<{
  content: string | null;
  dimensions: { width: number; height: number };
}> {
  try {
    // Construct the SVG path based on sheet ID
    const svgPath = `/sheets/${sheetId}.svg`;
    
    // Fetch the SVG content
    const response = await fetch(svgPath);
    
    if (response.ok) {
      const content = await response.text();
      
      // Extract width and height from SVG content
      let width = 3024; // Default width
      let height = 2160; // Default height
      
      // Try to parse dimensions from SVG content
      const widthMatch = content.match(/width="(\d+)"/);
      const heightMatch = content.match(/height="(\d+)"/);
      
      if (widthMatch && widthMatch[1]) {
        width = parseInt(widthMatch[1], 10);
      }
      
      if (heightMatch && heightMatch[1]) {
        height = parseInt(heightMatch[1], 10);
      }
      
      return {
        content,
        dimensions: { width, height }
      };
    }
    
    console.error(`Failed to fetch SVG for sheet ${sheetId}: ${response.status} ${response.statusText}`);
    return {
      content: null,
      dimensions: { width: 0, height: 0 }
    };
  } catch (error) {
    console.error(`Error fetching SVG for sheet ${sheetId}:`, error);
    return {
      content: null,
      dimensions: { width: 0, height: 0 }
    };
  }
}

/**
 * Find a bounding box by code in a specific sheet
 */
export async function findBoundingBoxInSheet(sheetIndex: number, code: string): Promise<BoundingBox | null> {
  try {
    // Use numeric sheetIndex directly
    const response = await fetch(`http://localhost:8080/api/sheets/${sheetIndex}/bounding-boxes`);
    
    if (response.ok) {
      const data = await response.json();
      const boxes = data.bounding_boxes || [];
      const foundBox = boxes.find((box: BoundingBox) => 
        box.code && box.code.toLowerCase() === code.toLowerCase()
      );
      return foundBox || null;
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}

/**
 * Search for a bounding box by code across all sheets
 */
export async function searchBoundingBoxAcrossSheets(code: string): Promise<{ box: BoundingBox, sheetIndex: number } | null> {
  // Search through all possible sheets (0-095)
  for (let i = 0; i <= 95; i++) {
    const foundBox = await findBoundingBoxInSheet(i, code);
    if (foundBox) {
      return { box: foundBox, sheetIndex: i };
    }
  }
  
  return null;
}

/**
 * Search for an integer pattern across all sheets
 * 
 * This function:
 * 1. Searches all analysis JSON files for integer patterns matching the given text
 * 2. For each match, it finds any bounding box that encloses the pattern's coordinates
 * 3. Returns all matches with their sheet information, coordinates, and enclosing bounding boxes
 * 
 * @param integerText The text of the integer pattern to search for
 * @returns Array of matches with sheet info, coordinates, and enclosing bounding boxes
 */
export async function searchIntegerPatternAcrossSheets(
  integerText: string
): Promise<IntegerPatternSearchResult[]> {
  const results: IntegerPatternSearchResult[] = [];
  
  // Define maximum sheet index to search (based on observed files)
  const MAX_SHEET_INDEX = 100;
  
  // Loop through all possible sheets
  for (let sheetIndex = 0; sheetIndex < MAX_SHEET_INDEX; sheetIndex++) {
    const sheetId = `page_${String(sheetIndex).padStart(3, '0')}`;
    
    try {
      // 1. Try to fetch the analysis file for this sheet
      const analysisResponse = await fetch(`/info_extract/info/analysis_${sheetId}.json`, { method: 'GET' });
      
      // Skip if file doesn't exist
      if (!analysisResponse.ok) continue;
      
      const analysisData = await analysisResponse.json();
      
      // 2. Look for matching integer patterns
      const matchingPatterns = (analysisData.patterns || [])
        .filter((pattern: any) => 
          pattern.pattern_type === 'integers' && 
          pattern.text === integerText
        );
      
      // Skip if no matches
      if (matchingPatterns.length === 0) continue;
      
      // 3. For each matching pattern, try to find enclosing bounding boxes
      for (const pattern of matchingPatterns) {
        // Prepare basic result
        const result: IntegerPatternSearchResult = {
          patternText: pattern.text,
          sheetIndex,
          sheetId,
          coordinates: pattern.coordinates,
          enclosingBoundingBox: null
        };
        
        try {
          // 4. Fetch bounding boxes for this sheet using database API
          const boundingBoxResponse = await fetch(`http://localhost:8080/api/sheets/${sheetIndex}/bounding-boxes`, { method: 'GET' });
          
          if (boundingBoxResponse.ok) {
            const boundingBoxData = await boundingBoxResponse.json();
            const boundingBoxes = boundingBoxData.bounding_boxes || [];
            
            // 5. Find any bounding box that encloses this pattern
            const enclosingBox = findEnclosingBoundingBox(pattern.coordinates, boundingBoxes);
            if (enclosingBox) {
              result.enclosingBoundingBox = enclosingBox;
            }
          }
        } catch (error) {
          console.error(`Error fetching bounding boxes for sheet ${sheetIndex}:`, error);
        }
        
        // Add result to collection
        results.push(result);
      }
    } catch (error) {
      console.error(`Error processing ${sheetId}:`, error);
      // Continue to next sheet
    }
  }
  
  return results;
}

/**
 * Helper function to find a bounding box that encloses the given coordinates
 */
function findEnclosingBoundingBox(coordinates: number[], boundingBoxes: BoundingBox[]): BoundingBox | null {
  // Extract pattern coordinates (assuming format is [x1, y1, x2, y2])
  const [x1, y1, x2, y2] = coordinates;
  
  // Pattern center point and dimensions
  const patternX = (x1 + x2) / 2;
  const patternY = (y1 + y2) / 2;
  const patternWidth = Math.abs(x2 - x1);
  const patternHeight = Math.abs(y2 - y1);
  
  // Find any bounding box that fully contains this pattern
  for (const box of boundingBoxes) {
    // Check if pattern is completely inside the bounding box
    // Add a small margin (5 pixels) for tolerance
    const margin = 5;
    
    if (
      patternX >= box.x - margin &&
      patternX <= box.x + box.width + margin &&
      patternY >= box.y - margin &&
      patternY <= box.y + box.height + margin
    ) {
      return box;
    }
  }
  
  return null;
}

/**
 * Update individual bounding box
 */
export async function updateBoundingBox(sheetId: string, boxId: string, updates: Partial<BoundingBox>): Promise<boolean> {
  try {
    const numericSheetId = parseSheetId(sheetId);
    const numericBoxId = parseInt(boxId);
    
    const response = await fetch(`http://localhost:8080/api/sheets/${numericSheetId}/bounding-boxes/${numericBoxId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error updating bounding box:', error);
    return false;
  }
}
