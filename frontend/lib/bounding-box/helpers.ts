/**
 * Helper functions for bounding box operations
 */

import { BoundingBox } from './types';

/**
 * Create a new bounding box with default values
 */
export function createBoundingBox(x: number, y: number): BoundingBox {
  return {
    id: `box_${Date.now()}`,
    x,
    y,
    width: 200,
    height: 100,
    code: '',
    title: 'New Box',
    content: '',
    type: 'figure',
    shape: 'rectangle',
    color: '#FF5722'
  };
}

/**
 * Create handlers for interacting with a bounding box
 */
export function createBoxHandlers(
  boxId: string,
  handleBoxSelect: (id: string) => void,
  updateBoundingBox: (id: string, updates: Partial<BoundingBox>) => void
) {
  return {
    onClick: (e: any) => {
      // Handle box selection
      handleBoxSelect(boxId);
    },
    onDragStart: (e: any) => {
      // Drag start logic
    },
    onDragMove: (e: any) => {
      // Drag move logic
    },
    onDragEnd: (e: any) => {
      // Update box position
      updateBoundingBox(boxId, {
        x: e.target.x(),
        y: e.target.y()
      });
    },
    onTransformEnd: (e: any) => {
      // Update box dimensions
      const node = e.target;
      
      // Store the current position and dimensions before any changes
      const currentX = node.x();
      const currentY = node.y();
      const currentWidth = node.width();
      const currentHeight = node.height();
      
      // Get the scale values applied by the transformer
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      
      // Calculate the actual width and height after transformation
      // Make sure we're preserving the dimensions properly
      const newWidth = Math.max(5, currentWidth * scaleX);
      const newHeight = Math.max(5, currentHeight * scaleY);
      
      // Reset scale to avoid cumulative scaling issues
      node.scaleX(1);
      node.scaleY(1);
      
      // Set the explicit width and height on the node
      node.width(newWidth);
      node.height(newHeight);
      
      // Update the box in the state with new dimensions
      updateBoundingBox(boxId, {
        x: currentX,
        y: currentY,
        width: newWidth,
        height: newHeight
      });
    }
  };
}
