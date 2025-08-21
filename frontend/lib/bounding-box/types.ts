/**
 * Types and interfaces related to bounding boxes
 */

export interface BoundingBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  code: string;
  title: string;
  content: string;
  type: 'figure' | 'table' | 'text';
  shape: 'circle' | 'square' | 'rectangle' | 'hexagon' | 'other' | 'none';
  color: string;
  pageWidth?: number;    // Chunkr reference page width
  pageHeight?: number;   // Chunkr reference page height
  userModified?: boolean; // Whether box was modified by user
}

export interface ZoomWindow {
  id: string;
  boundingBox: BoundingBox;
  position: { x: number, y: number };
  sourcePattern?: any; // The original pattern that was clicked to create this zoom window
  parentId?: string; // ID of the parent zoom window (for nested windows)
  level?: number; // Nesting level (0 for root, 1 for first child, etc.)
}

export interface BoundingBoxFile {
  document_info: {
    pdf_name: string;
    page_number: number;
    svg_dimensions: {
      width: number;
      height: number;
    };
  };
  bounding_boxes: BoundingBox[];
  metadata: {
    created_date: string;
    modified_date: string;
    version: string;
    total_boxes: number;
    box_types: {
      figure: number;
      table: number;
      text: number;
    };
  };
}

/**
 * Result type for searching integer patterns across sheets
 */
export interface IntegerPatternSearchResult {
  patternText: string;
  sheetIndex: number;
  sheetId: string;
  coordinates: number[];
  enclosingBoundingBox?: BoundingBox | null;
}
