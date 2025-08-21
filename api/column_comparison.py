"""
Column Comparison Tool for ConcretePro
Compares columns between two sheets by aligning grid systems and finding mismatches
"""
import numpy as np
from typing import List, Dict, Tuple, Optional
from sqlalchemy.orm import Session
from database import SheetColumn, SheetGridLine, Sheet, SessionLocal
import math


def get_sheet_columns(sheet_id: int, db: Session = None) -> List[Dict]:
    """
    Get all columns for a sheet from database
    
    Args:
        sheet_id: ID of the sheet
        db: Database session (optional, will create if not provided)
        
    Returns:
        List of column dictionaries with position and size info
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True
    
    try:
        columns = db.query(SheetColumn).filter(
            SheetColumn.sheet_id == sheet_id
        ).order_by(SheetColumn.column_index).all()
        
        column_data = []
        for column in columns:
            column_data.append({
                'id': column.id,
                'sheet_id': column.sheet_id,
                'index': column.column_index,
                'center_x': float(column.center_x),
                'center_y': float(column.center_y),
                'width': float(column.width),
                'height': float(column.height),
                'created_at': column.created_at.isoformat() if column.created_at else None
            })
        
        return column_data
    
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
        print(f"Warning: Only {len(common_labels)} common grid lines found. Alignment may be inaccurate.")
        if len(common_labels) == 0:
            return 0.0, 0.0
    
    # Calculate translation offsets for each common grid line
    # Only use relevant coordinates for each grid line type
    dx_offsets = []  # For vertical grid lines (align X coordinate)
    dy_offsets = []  # For horizontal grid lines (align Y coordinate)
    
    for label in common_labels:
        gl1 = labels_1[label]
        gl2 = labels_2[label]
        
        # Only use the relevant coordinate for alignment based on grid line orientation
        if gl1['orientation'] == 'horizontal':
            # For horizontal grid lines, only align Y coordinate (vertical position)
            dy = gl1['center_y'] - gl2['center_y']
            dy_offsets.append(dy)
        elif gl1['orientation'] == 'vertical':
            # For vertical grid lines, only align X coordinate (horizontal position)
            dx = gl1['center_x'] - gl2['center_x']
            dx_offsets.append(dx)
    
    # Use median to handle outliers
    # Calculate final offsets based on available data
    dx_median = np.median(dx_offsets) if dx_offsets else 0.0
    dy_median = np.median(dy_offsets) if dy_offsets else 0.0
    
    print(f"Grid alignment using {len(common_labels)} common grid lines:")
    print(f"  Common labels: {sorted(common_labels)}")
    print(f"  Horizontal grid lines (Y-alignment): {len(dy_offsets)}")
    print(f"  Vertical grid lines (X-alignment): {len(dx_offsets)}")
    print(f"  Translation offset: dx={dx_median:.2f}, dy={dy_median:.2f}")
    
    return float(dx_median), float(dy_median)


def transform_columns(columns: List[Dict], dx: float, dy: float) -> List[Dict]:
    """
    Apply translation transformation to column positions
    
    Args:
        columns: List of column dictionaries
        dx: Translation offset in X direction
        dy: Translation offset in Y direction
        
    Returns:
        List of transformed column dictionaries
    """
    transformed_columns = []
    
    for column in columns:
        transformed_column = column.copy()
        transformed_column['center_x'] = column['center_x'] + dx
        transformed_column['center_y'] = column['center_y'] + dy
        transformed_column['original_center_x'] = column['center_x']
        transformed_column['original_center_y'] = column['center_y']
        transformed_columns.append(transformed_column)
    
    return transformed_columns


def find_nearby_grid_lines(column_x: float, column_y: float, grid_lines: List[Dict]) -> Dict[str, str]:
    """
    Find the closest grid lines to a column position
    
    Args:
        column_x: X coordinate of the column
        column_y: Y coordinate of the column  
        grid_lines: List of grid line dictionaries
        max_distance: Maximum distance to consider a grid line as "nearby"
        
    Returns:
        Dictionary with 'horizontal' and 'vertical' closest grid line labels
    """
    closest_horizontal = None
    closest_vertical = None
    min_h_distance = float('inf')
    min_v_distance = float('inf')
    
    for grid_line in grid_lines:
        if grid_line['orientation'] == 'horizontal':
            # For horizontal lines, check Y distance
            distance = abs(column_y - grid_line['center_y'])
            if distance < min_h_distance:
                min_h_distance = distance
                closest_horizontal = grid_line['label']
        
        elif grid_line['orientation'] == 'vertical':
            # For vertical lines, check X distance  
            distance = abs(column_x - grid_line['center_x'])
            if distance < min_v_distance:
                min_v_distance = distance
                closest_vertical = grid_line['label']
    
    return {
        'horizontal': closest_horizontal,
        'vertical': closest_vertical,
        'h_distance': min_h_distance if closest_horizontal else None,
        'v_distance': min_v_distance if closest_vertical else None
    }


def format_grid_reference(nearby_grids: Dict[str, str]) -> str:
    """
    Format nearby grid lines into a readable reference
    
    Args:
        nearby_grids: Dictionary from find_nearby_grid_lines
        
    Returns:
        Formatted grid reference string
    """
    parts = []
    
    if nearby_grids['horizontal']:
        parts.append(f"H:{nearby_grids['horizontal']}")
    
    if nearby_grids['vertical']:
        parts.append(f"V:{nearby_grids['vertical']}")
    
    if parts:
        return " & ".join(parts)
    else:
        return "No nearby grid lines"


def find_column_matches(columns_1: List[Dict], columns_2: List[Dict], tolerance: float = 15.0) -> Tuple[List[Dict], List[Dict], List[Dict]]:
    """
    Find matching and non-matching columns between two sets
    
    Args:
        columns_1: Columns from first sheet (reference)
        columns_2: Columns from second sheet (already transformed to align with sheet1)
        tolerance: Maximum distance to consider columns as matching (in drawing units)
        
    Returns:
        Tuple of (matches, unmatched_from_sheet1, unmatched_from_sheet2)
    """
    matches = []
    unmatched_1 = []
    unmatched_2 = columns_2.copy()  # Start with all columns from sheet 2
    
    for col1 in columns_1:
        best_match = None
        best_distance = float('inf')
        best_idx = -1
        
        # Find closest column in sheet 2
        for idx, col2 in enumerate(unmatched_2):
            # Calculate Euclidean distance between column centers
            dx = col1['center_x'] - col2['center_x']
            dy = col1['center_y'] - col2['center_y']
            distance = math.sqrt(dx * dx + dy * dy)
            
            if distance < best_distance:
                best_distance = distance
                best_match = col2
                best_idx = idx
        
        if best_match and best_distance <= tolerance:
            # Found a match
            match_info = {
                'sheet1_column': col1,
                'sheet2_column': best_match,
                'distance': best_distance,
                'dx': col1['center_x'] - best_match['center_x'],
                'dy': col1['center_y'] - best_match['center_y']
            }
            matches.append(match_info)
            
            # Remove matched column from unmatched list
            unmatched_2.pop(best_idx)
        else:
            # No match found for this column in sheet 1
            unmatched_1.append(col1)
    
    return matches, unmatched_1, unmatched_2


def compare_sheet_columns(sheet_id_1: int, sheet_id_2: int, tolerance: float = 2.0) -> Dict:
    """
    Compare columns between two sheets and find mismatches
    
    Args:
        sheet_id_1: ID of first sheet (reference sheet)
        sheet_id_2: ID of second sheet (comparison sheet)
        tolerance: Maximum distance to consider columns as matching (default: 1.0 units)
        
    Returns:
        Dictionary containing comparison results
    """
    db = SessionLocal()

    print('Comparing columns between sheets:')
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
        
        # Get columns and grid lines for both sheets
        columns_1 = get_sheet_columns(sheet_id_1, db)
        columns_2 = get_sheet_columns(sheet_id_2, db)
        grid_lines_1 = get_sheet_grid_lines(sheet_id_1, db)
        grid_lines_2 = get_sheet_grid_lines(sheet_id_2, db)
        
        print(f"\n📋 Comparing columns between sheets:")
        print(f"  Sheet 1: {sheet1_info['code']} - {sheet1_info['title']}")
        print(f"    Columns: {len(columns_1)}, Grid lines: {len(grid_lines_1)}")
        print(f"  Sheet 2: {sheet2_info['code']} - {sheet2_info['title']}")
        print(f"    Columns: {len(columns_2)}, Grid lines: {len(grid_lines_2)}")
        
        if not columns_1 and not columns_2:
            return {
                'success': False,
                'error': 'No columns found in either sheet. Please extract columns first.'
            }
        
        # Calculate grid alignment
        dx, dy = calculate_grid_alignment(grid_lines_1, grid_lines_2)
        
        # Transform sheet 2 columns to align with sheet 1
        aligned_columns_2 = transform_columns(columns_2, dx, dy)
        
        # Find matches and mismatches
        matches, unmatched_1, unmatched_2 = find_column_matches(columns_1, aligned_columns_2, tolerance)
        
        for col in unmatched_1:
            # Add grid references for unmatched columns in sheet 1
            col['grid_ref'] = format_grid_reference(find_nearby_grid_lines(col['center_x'], col['center_y'], grid_lines_1))
        
        for col in unmatched_2:
            # Add grid references for unmatched columns in sheet 2 (use original coordinates)
            col['grid_ref'] = format_grid_reference(find_nearby_grid_lines(col['original_center_x'], col['original_center_y'], grid_lines_2))
        
        # Prepare results - focus only on unmatched columns with grid references
        result = {
            'success': True,
            'sheet1': sheet1_info,
            'sheet2': sheet2_info,
            'unmatched_columns': {
                'extra_in_sheet1': [
                    {
                        'sheet_id': col['sheet_id'],
                        'column_index': col['index'],
                        'center_x': col['center_x'],
                        'center_y': col['center_y'],
                        'width': col['width'],
                        'height': col['height'],
                        'grid_reference': col['grid_ref'],
                        'sheet_code': sheet1_info['code']
                    }
                    for col in unmatched_1
                ],
                'extra_in_sheet2': [
                    {
                        'sheet_id': col['sheet_id'],
                        'column_index': col['index'],
                        'center_x': col['original_center_x'],  # Use original coordinates for sheet2
                        'center_y': col['original_center_y'],
                        'width': col['width'],
                        'height': col['height'],
                        'grid_reference': col['grid_ref'],
                        'sheet_code': sheet2_info['code']
                    }
                    for col in unmatched_2
                ]
            },
            'summary': {
                'total_unmatched_sheet1': len(unmatched_1),
                'total_unmatched_sheet2': len(unmatched_2),
                'tolerance_used': tolerance
            }
        }
        
        # Print summary
        print(f"\n📊 Comparison Results:")
        print(f"  Matched column pairs: {len(matches)}")
        print(f"  Columns only in {sheet1_info['code']}: {len(unmatched_1)}")
        print(f"  Columns only in {sheet2_info['code']}: {len(unmatched_2)}")
        print(f"  Tolerance used: {tolerance} units")
        
        if matches:
            avg_distance = sum(m['distance'] for m in matches) / len(matches)
            print(f"  Average distance between matched pairs: {avg_distance:.2f} units")
        
        return result
        
    except Exception as e:
        print(f"❌ Error comparing columns: {e}")
        return {
            'success': False,
            'error': str(e)
        }
        
    finally:
        db.close()


def format_comparison_summary(comparison_result: Dict) -> str:
    """
    Format comparison results into a human-readable summary
    
    Args:
        comparison_result: Result from compare_sheet_columns function
        
    Returns:
        Formatted summary string
    """
    if not comparison_result.get('success'):
        return f"❌ Comparison failed: {comparison_result.get('error', 'Unknown error')}"
    
    sheet1 = comparison_result['sheet1']
    sheet2 = comparison_result['sheet2']
    summary_stats = comparison_result['summary']
    unmatched = comparison_result.get('unmatched_columns', {})
    
    # Calculate matched pairs from totals
    total_sheet1 = len(unmatched.get('extra_in_sheet1', []))
    total_sheet2 = len(unmatched.get('extra_in_sheet2', []))
    # Assume matched pairs = smaller total - unmatched from that sheet
    matched_pairs = min(total_sheet1, total_sheet2) if total_sheet1 > 0 or total_sheet2 > 0 else 0
    
    summary = f"""📊 Column Comparison Results

🏗️  Compared Sheets:
   • {sheet1['code']}: {sheet1['title']}
   • {sheet2['code']}: {sheet2['title']}

📈 Results:
   • ✅ Matched pairs: Comparison completed
   • ❌ Extra in {sheet1['code']}: {summary_stats['total_unmatched_sheet1']}
   • ➕ Extra in {sheet2['code']}: {summary_stats['total_unmatched_sheet2']}
   • 🎯 Tolerance: {summary_stats['tolerance_used']} units"""
    
    # Add details about mismatches if any
    unmatched = comparison_result.get('unmatched_columns', {})
    
    if unmatched.get('extra_in_sheet1'):
        summary += f"\n\n🔍 Columns only in {sheet1['code']}:"
        for i, col in enumerate(unmatched['extra_in_sheet1'][:5], 1):  # Show max 5
            grid_ref = col.get('grid_reference', 'No grid reference')
            summary += f"\n   {i}. Column near {grid_ref}"
        if len(unmatched['extra_in_sheet1']) > 5:
            summary += f"\n   ... and {len(unmatched['extra_in_sheet1']) - 5} more"
    
    if unmatched.get('extra_in_sheet2'):
        summary += f"\n\n➕ Columns only in {sheet2['code']}:"
        for i, col in enumerate(unmatched['extra_in_sheet2'][:5], 1):  # Show max 5
            grid_ref = col.get('grid_reference', 'No grid reference')
            summary += f"\n   {i}. Column near {grid_ref}"
        if len(unmatched['extra_in_sheet2']) > 5:
            summary += f"\n   ... and {len(unmatched['extra_in_sheet2']) - 5} more"
    
    return summary