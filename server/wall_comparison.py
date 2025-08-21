"""
Wall Comparison Tool for ConcretePro
Compares walls between two sheets by aligning grid systems and finding mismatches
"""
import numpy as np
from typing import List, Dict, Tuple, Optional
from sqlalchemy.orm import Session
from database import SheetWall, SheetGridLine, Sheet, SessionLocal
import math


def get_sheet_walls(sheet_id: int, db: Session = None) -> List[Dict]:
    """
    Get all walls for a sheet from database
    
    Args:
        sheet_id: ID of the sheet
        db: Database session (optional, will create if not provided)
        
    Returns:
        List of wall dictionaries with position and size info
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        walls = db.query(SheetWall).filter(
            SheetWall.sheet_id == sheet_id
        ).order_by(SheetWall.index).all()
        
        wall_data = []
        for wall in walls:
            wall_data.append({
                'id': wall.id,
                'sheet_id': wall.sheet_id,
                'index': wall.index,
                'center_x': float(wall.center_x),
                'center_y': float(wall.center_y),
                'width': float(wall.width),
                'height': float(wall.height),
                'orientation': wall.orientation,
                'thickness': float(wall.thickness),
                'length': float(wall.length),
                'aspect_ratio': float(wall.aspect_ratio) if wall.aspect_ratio else 0,
                'created_at': wall.created_at.isoformat() if wall.created_at else None
            })
        
        return wall_data
    
    finally:
        if close_db:
            db.close()


def get_sheet_grid_lines(sheet_id: int, db: Session = None) -> List[Dict]:
    """
    Get all grid lines for a sheet from database
    
    Args:
        sheet_id: ID of the sheet
        db: Database session (optional, will create if not provided)
        
    Returns:
        List of grid line dictionaries with position and label info
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        grid_lines = db.query(SheetGridLine).filter(
            SheetGridLine.sheet_id == sheet_id
        ).order_by(SheetGridLine.label).all()
        
        grid_data = []
        for grid_line in grid_lines:
            grid_data.append({
                'id': grid_line.id,
                'sheet_id': grid_line.sheet_id,
                'label': grid_line.label,
                'category': grid_line.category,  # 'hotel' or 'residence'
                'orientation': grid_line.orientation,  # 'vertical' or 'horizontal'
                'center_x': float(grid_line.center_x),
                'center_y': float(grid_line.center_y),
                'bbox_width': float(grid_line.bbox_width),
                'bbox_height': float(grid_line.bbox_height),
                'created_at': grid_line.created_at.isoformat() if grid_line.created_at else None
            })
        
        return grid_data
    
    finally:
        if close_db:
            db.close()


def get_sheet_info(sheet_id: int, db: Session = None) -> Optional[Dict]:
    """
    Get sheet information from database
    
    Args:
        sheet_id: ID of the sheet
        db: Database session (optional, will create if not provided)
        
    Returns:
        Sheet information dictionary or None if not found
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            return None
            
        return {
            'id': sheet.id,
            'code': sheet.code,
            'title': sheet.title,
            'type': sheet.type,
            'page': sheet.page,
            'status': sheet.status,
            'document_id': sheet.document_id
        }
    
    finally:
        if close_db:
            db.close()


def calculate_grid_alignment(grid_lines_1: List[Dict], grid_lines_2: List[Dict]) -> Tuple[float, float]:
    """
    Calculate translation offset between two sheets based on their grid lines
    
    Args:
        grid_lines_1: Grid lines from first sheet
        grid_lines_2: Grid lines from second sheet
        
    Returns:
        Tuple of (dx, dy) translation offset to align sheet2 to sheet1 coordinate system
    """
    # Find common grid line labels between the two sheets
    labels_1 = {gl['label']: gl for gl in grid_lines_1}
    labels_2 = {gl['label']: gl for gl in grid_lines_2}
    
    common_labels = set(labels_1.keys()) & set(labels_2.keys())
    
    if len(common_labels) < 2:
        print(f"⚠️ Warning: Only {len(common_labels)} common grid lines found. Alignment may be inaccurate.")
        if len(common_labels) == 0:
            return 0.0, 0.0  # No alignment possible
    
    # Calculate translation offsets using common grid lines
    dx_values = []
    dy_values = []
    
    for label in common_labels:
        gl1 = labels_1[label]
        gl2 = labels_2[label]
        
        dx = gl1['center_x'] - gl2['center_x']
        dy = gl1['center_y'] - gl2['center_y']
        
        dx_values.append(dx)
        dy_values.append(dy)
    
    # Use median to be robust against outliers
    dx = float(np.median(dx_values)) if dx_values else 0.0
    dy = float(np.median(dy_values)) if dy_values else 0.0
    
    print(f"🎯 Grid alignment offset: dx={dx:.2f}, dy={dy:.2f} (based on {len(common_labels)} common grid lines)")
    
    return dx, dy


def transform_walls(walls: List[Dict], dx: float, dy: float) -> List[Dict]:
    """
    Transform wall positions by translation offset
    
    Args:
        walls: List of wall dictionaries
        dx: Translation offset in X direction
        dy: Translation offset in Y direction
        
    Returns:
        List of transformed wall dictionaries (with original coordinates preserved)
    """
    transformed = []
    for wall in walls:
        transformed_wall = wall.copy()
        
        # Store original coordinates
        transformed_wall['original_center_x'] = wall['center_x']
        transformed_wall['original_center_y'] = wall['center_y']
        
        # Apply transformation
        transformed_wall['center_x'] = wall['center_x'] + dx
        transformed_wall['center_y'] = wall['center_y'] + dy
        
        transformed.append(transformed_wall)
    
    return transformed


def find_wall_matches(walls_1: List[Dict], walls_2: List[Dict], tolerance: float = 2.0) -> Tuple[List[Dict], List[Dict], List[Dict]]:
    """
    Find matching and unmatched walls between two sheets
    
    Args:
        walls_1: Walls from first sheet
        walls_2: Walls from second sheet (already aligned)
        tolerance: Maximum distance to consider walls as matching
        
    Returns:
        Tuple of (matches, unmatched_in_sheet1, unmatched_in_sheet2)
    """
    matches = []
    unmatched_1 = walls_1.copy()
    unmatched_2 = walls_2.copy()
    
    # Find matches based on position, size, and orientation
    for i, wall1 in enumerate(walls_1):
        best_match = None
        best_distance = float('inf')
        best_match_idx = -1
        
        for j, wall2 in enumerate(walls_2):
            # Check if orientations match
            if wall1['orientation'] != wall2['orientation']:
                continue
            
            # Calculate center distance
            distance = math.sqrt(
                (wall1['center_x'] - wall2['center_x'])**2 + 
                (wall1['center_y'] - wall2['center_y'])**2
            )
            
            # Check size similarity (width, height, thickness)
            width_diff = abs(wall1['width'] - wall2['width'])
            height_diff = abs(wall1['height'] - wall2['height'])
            thickness_diff = abs(wall1['thickness'] - wall2['thickness'])
            
            # Allow small differences in dimensions (±10%)
            max_width_diff = max(wall1['width'], wall2['width']) * 0.1
            max_height_diff = max(wall1['height'], wall2['height']) * 0.1
            max_thickness_diff = max(wall1['thickness'], wall2['thickness']) * 0.1
            
            # Wall matches if position is close AND dimensions are similar
            if (distance <= tolerance and 
                width_diff <= max_width_diff and 
                height_diff <= max_height_diff and 
                thickness_diff <= max_thickness_diff):
                
                if distance < best_distance:
                    best_distance = distance
                    best_match = wall2
                    best_match_idx = j
        
        # If we found a good match, record it
        if best_match is not None:
            matches.append({
                'wall1': wall1,
                'wall2': best_match,
                'distance': best_distance
            })
            
            # Remove from unmatched lists
            if wall1 in unmatched_1:
                unmatched_1.remove(wall1)
            if best_match in unmatched_2:
                unmatched_2.remove(best_match)
    
    print(f"🔍 Wall matching results:")
    print(f"  Matches found: {len(matches)}")
    print(f"  Unmatched in sheet1: {len(unmatched_1)}")
    print(f"  Unmatched in sheet2: {len(unmatched_2)}")
    
    return matches, unmatched_1, unmatched_2


def find_nearby_grid_lines(x: float, y: float, grid_lines: List[Dict], max_distance: float = 50.0) -> List[Dict]:
    """
    Find grid lines near a given point
    
    Args:
        x: X coordinate of the point
        y: Y coordinate of the point
        grid_lines: List of grid line dictionaries
        max_distance: Maximum distance to search for grid lines
        
    Returns:
        List of nearby grid lines with distances
    """
    nearby = []
    
    for grid_line in grid_lines:
        distance = math.sqrt(
            (x - grid_line['center_x'])**2 + 
            (y - grid_line['center_y'])**2
        )
        
        if distance <= max_distance:
            nearby.append({
                'grid_line': grid_line,
                'distance': distance
            })
    
    # Sort by distance and return closest ones
    nearby.sort(key=lambda x: x['distance'])
    return nearby[:4]  # Return up to 4 closest grid lines


def format_grid_reference(nearby_grid_lines: List[Dict]) -> str:
    """
    Format grid line references into a readable string
    
    Args:
        nearby_grid_lines: List of nearby grid lines with distances
        
    Returns:
        Formatted string describing the grid line references
    """
    if not nearby_grid_lines:
        return "No nearby grid lines"
    
    # Group by orientation
    vertical_grids = []
    horizontal_grids = []
    
    for item in nearby_grid_lines:
        grid_line = item['grid_line']
        if grid_line['orientation'] == 'vertical':
            vertical_grids.append(grid_line['label'])
        else:
            horizontal_grids.append(grid_line['label'])
    
    parts = []
    if vertical_grids:
        parts.append(f"vertical: {', '.join(vertical_grids[:2])}")
    if horizontal_grids:
        parts.append(f"horizontal: {', '.join(horizontal_grids[:2])}")
    
    return "; ".join(parts) if parts else "No grid reference"


def compare_sheet_walls(sheet_id_1: int, sheet_id_2: int, tolerance: float = 2.0) -> Dict:
    """
    Compare walls between two sheets and find mismatches
    
    Args:
        sheet_id_1: ID of first sheet (reference sheet)
        sheet_id_2: ID of second sheet (comparison sheet)
        tolerance: Maximum distance to consider walls as matching (default: 2.0 units)
        
    Returns:
        Dictionary containing comparison results
    """
    db = SessionLocal()
    print('🧱 Comparing walls between sheets:')
    print(f'  Sheet 1: {sheet_id_1}')
    print(f'  Sheet 2: {sheet_id_2}')
    try:
        # Get sheet information
        sheet1_info = get_sheet_info(sheet_id_1, db)
        sheet2_info = get_sheet_info(sheet_id_2, db)
        
        if not sheet1_info or not sheet2_info:
            return {
                'success': False,
                'error': f'Sheet not found: {sheet_id_1 if not sheet1_info else sheet_id_2}'
            }
        
        # Get walls and grid lines for both sheets
        walls_1 = get_sheet_walls(sheet_id_1, db)
        walls_2 = get_sheet_walls(sheet_id_2, db)
        grid_lines_1 = get_sheet_grid_lines(sheet_id_1, db)
        grid_lines_2 = get_sheet_grid_lines(sheet_id_2, db)
        
        print(f"\n📋 Comparing walls between sheets:")
        print(f"  Sheet 1: {sheet1_info['code']} - {sheet1_info['title']}")
        print(f"    Walls: {len(walls_1)}, Grid lines: {len(grid_lines_1)}")
        print(f"  Sheet 2: {sheet2_info['code']} - {sheet2_info['title']}")
        print(f"    Walls: {len(walls_2)}, Grid lines: {len(grid_lines_2)}")
        
        if not walls_1 and not walls_2:
            return {
                'success': False,
                'error': 'No walls found in either sheet. Please extract walls first.'
            }
        
        # Calculate grid alignment
        dx, dy = calculate_grid_alignment(grid_lines_1, grid_lines_2)
        
        # Transform sheet 2 walls to align with sheet 1
        aligned_walls_2 = transform_walls(walls_2, dx, dy)
        
        # Find matches and mismatches
        matches, unmatched_1, unmatched_2 = find_wall_matches(walls_1, aligned_walls_2, tolerance)
        
        # Add grid references for unmatched walls
        for wall in unmatched_1:
            wall['grid_ref'] = format_grid_reference(find_nearby_grid_lines(wall['center_x'], wall['center_y'], grid_lines_1))
        
        for wall in unmatched_2:
            # Use original coordinates for grid reference lookup
            wall['grid_ref'] = format_grid_reference(find_nearby_grid_lines(wall['original_center_x'], wall['original_center_y'], grid_lines_2))
        
        # Prepare results - focus only on unmatched walls with grid references
        result = {
            'success': True,
            'sheet1': sheet1_info,
            'sheet2': sheet2_info,
            'unmatched_walls': {
                'extra_in_sheet1': [
                    {
                        'sheet_id': wall['sheet_id'],
                        'wall_index': wall['index'],
                        'center_x': wall['center_x'],
                        'center_y': wall['center_y'],
                        'width': wall['width'],
                        'height': wall['height'],
                        'orientation': wall['orientation'],
                        'thickness': wall['thickness'],
                        'length': wall['length'],
                        'grid_reference': wall['grid_ref'],
                        'sheet_code': sheet1_info['code']
                    }
                    for wall in unmatched_1
                ],
                'extra_in_sheet2': [
                    {
                        'sheet_id': wall['sheet_id'],
                        'wall_index': wall['index'],
                        'center_x': wall['original_center_x'],  # Use original coordinates
                        'center_y': wall['original_center_y'],
                        'width': wall['width'],
                        'height': wall['height'],
                        'orientation': wall['orientation'],
                        'thickness': wall['thickness'],
                        'length': wall['length'],
                        'grid_reference': wall['grid_ref'],
                        'sheet_code': sheet2_info['code']
                    }
                    for wall in unmatched_2
                ]
            },
            'summary': {
                'total_unmatched_sheet1': len(unmatched_1),
                'total_unmatched_sheet2': len(unmatched_2),
                'tolerance_used': tolerance,
                'total_walls_sheet1': len(walls_1),
                'total_walls_sheet2': len(walls_2),
                'matches_found': len(matches),
                'alignment_offset': {'dx': dx, 'dy': dy}
            }
        }
        
        print(f"✅ Wall comparison completed successfully!")
        return result
        
    except Exception as e:
        print(f"❌ Error during wall comparison: {e}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': f'Error during wall comparison: {str(e)}'
        }
    finally:
        db.close()


def format_comparison_summary(result: Dict) -> str:
    """
    Format the comparison result into a human-readable summary
    
    Args:
        result: Result dictionary from compare_sheet_walls
        
    Returns:
        Formatted summary string
    """
    if not result.get('success'):
        return f"❌ Wall comparison failed: {result.get('error', 'Unknown error')}"
    
    summary = result['summary']
    sheet1 = result['sheet1']
    sheet2 = result['sheet2']
    
    lines = [
        f"🧱 Wall Comparison Results:",
        f"📄 Sheet 1: {sheet1['code']} ({summary['total_walls_sheet1']} walls)",
        f"📄 Sheet 2: {sheet2['code']} ({summary['total_walls_sheet2']} walls)",
        f"",
        f"🎯 Alignment: dx={summary['alignment_offset']['dx']:.1f}, dy={summary['alignment_offset']['dy']:.1f}",
        f"✅ Matches found: {summary['matches_found']}",
        f"❌ Unmatched walls:",
        f"   • Extra in {sheet1['code']}: {summary['total_unmatched_sheet1']}",
        f"   • Extra in {sheet2['code']}: {summary['total_unmatched_sheet2']}",
        f""
    ]
    
    # List unmatched walls with their grid references
    unmatched = result['unmatched_walls']
    
    if unmatched['extra_in_sheet1']:
        lines.append(f"🔍 Walls only in {sheet1['code']}:")
        for wall in unmatched['extra_in_sheet1']:
            lines.append(f"   • W{wall['wall_index']} ({wall['orientation']}, {wall['thickness']:.1f}×{wall['length']:.1f}) near {wall['grid_reference']}")
    
    if unmatched['extra_in_sheet2']:
        lines.append(f"🔍 Walls only in {sheet2['code']}:")
        for wall in unmatched['extra_in_sheet2']:
            lines.append(f"   • W{wall['wall_index']} ({wall['orientation']}, {wall['thickness']:.1f}×{wall['length']:.1f}) near {wall['grid_reference']}")
    
    return "\n".join(lines)