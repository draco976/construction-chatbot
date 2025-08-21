"""
Column extraction utility for construction drawings
"""
import fitz
import os
from typing import List, Dict, Tuple
from sqlalchemy.orm import Session
from database import SheetColumn, Sheet, Document, Project, SessionLocal


def detect_plan_type(sheet_title: str, sheet_type: str = None) -> str:
    """
    Detect the plan type based on sheet title and sheet type
    
    Args:
        sheet_title: Title of the sheet
        sheet_type: Type of the sheet (if available)
        
    Returns:
        str: Plan type ('structural', 'architectural', 'slab', or 'unknown')
    """
    # First check sheet type if available
    if sheet_type:
        sheet_type_upper = sheet_type.upper()
        sheet_title_upper = sheet_title.upper() if sheet_title else ""
        
        # Direct mapping from sheet type
        if 'S' in sheet_type_upper and 'FLOOR PLAN' in sheet_title_upper:
            return "structural"
        elif 'A' in sheet_type_upper and 'FLOOR PLAN' in sheet_title_upper:
            return "architectural"
        elif 'SLAB' in sheet_type_upper:
            return "slab"
    
    # Fallback to title-based detection
    if not sheet_title:
        return "unknown"
        
    # Convert title to uppercase for keyword matching
    title = sheet_title.upper()
    
    # Look for plan type indicators in the title
    structural_keywords = ['STRUCTURAL', 'FOUNDATION', 'FRAMING', 'BEAM', 'COLUMN SCHEDULE']
    architectural_keywords = ['ARCHITECTURAL', 'FLOOR PLAN', 'PLAN VIEW', 'FURNITURE']
    slab_keywords = ['SLAB']
    
    structural_score = sum(1 for keyword in structural_keywords if keyword in title)
    architectural_score = sum(1 for keyword in architectural_keywords if keyword in title)
    slab_score = sum(1 for keyword in slab_keywords if keyword in title)
    
    # Determine plan type based on keyword matches
    if structural_score > architectural_score and structural_score > slab_score:
        return "structural"
    elif architectural_score > slab_score:
        return "architectural"
    elif slab_score > 0:
        return "slab"
    else:
        return "unknown"


def extract_column_centers_slab(pdf_path: str, page_number: int) -> List[Dict]:
    """
    Extract column centers from slab plans (original method)
    """
    doc = fitz.open(pdf_path)
    
    if page_number > len(doc):
        print(f"Error: Page {page_number} does not exist. PDF has {len(doc)} pages.")
        doc.close()
        return []
    
    page = doc[page_number - 1]
    drawings = page.get_drawings()
    
    print(f"Processing slab plan on page {page_number}")
    print(f"Found {len(drawings)} total drawings on page")
    
    columns = []
    column_count = 0
    
    # Process each drawing to find columns
    for i, drawing in enumerate(drawings):
        drawing_type = drawing.get('type', 'Unknown')
        
        # Check if drawing type is 'f' (filled) - columns are filled shapes
        if drawing_type == 'f':
            rect = drawing.get('rect')
            fill_color = drawing.get('fill', [0, 0, 0])
            
            # Filter by fill color (0.753 for slab plans)
            if abs(fill_color[0] - 0.753) > 0.001:
                continue
            
            if rect:
                width = abs(rect.x1 - rect.x0)
                height = abs(rect.y1 - rect.y0)
                
                # Filter by size constraints (10-20 units for slab plans)
                if width < 10 or height < 10 or width > 20 or height > 20:
                    continue
                
                # Calculate center point
                center_x = (rect.x0 + rect.x1) / 2
                center_y = (rect.y0 + rect.y1) / 2
                
                column_data = {
                    "index": column_count,
                    "center": (center_x, center_y),
                    "center_x": center_x,
                    "center_y": center_y,
                    "width": width,
                    "height": height,
                    "plan_type": "slab"
                }
                
                columns.append(column_data)
                column_count += 1
                
                print(f"Column {column_count}: Center ({center_x:.1f}, {center_y:.1f}), "
                      f"Bounds: ({rect.x0:.1f}, {rect.y0:.1f}, {rect.x1:.1f}, {rect.y1:.1f})")
    
    doc.close()
    print(f"Found {len(columns)} columns in slab plan")
    return columns


def extract_column_centers_floor_structural(pdf_path: str, page_number: int, plan_type: str) -> List[Dict]:
    """
    Extract column centers from floor plans and structural plans using fill color detection
    """
    doc = fitz.open(pdf_path)
    
    if page_number > len(doc):
        print(f"Error: Page {page_number} does not exist. PDF has {len(doc)} pages.")
        doc.close()
        return []
    
    page = doc[page_number - 1]
    drawings = page.get_drawings()
    
    print(f"Processing {plan_type} plan on page {page_number}")
    print(f"Found {len(drawings)} total drawings on page")
    
    # Plan-type specific fill colors for column identification
    target_fill_colors = {
        "structural": 1.0,      # White fill
        "architectural": 0.498,  # Medium gray fill
    }
    
    target_fill_color = target_fill_colors.get(plan_type)
    if target_fill_color is None:
        print(f"Warning: Unknown plan type '{plan_type}', using default detection")
        target_fill_color = 0.8
    
    print(f"Looking for fill color: {target_fill_color}")
    
    columns = []
    column_id = 1
    
    # Process each drawing to find columns
    for i, drawing in enumerate(drawings):
        drawing_type = drawing.get('type', 'Unknown')
        
        # Check if drawing type is 'f' (filled) - columns are filled shapes
        if drawing_type == 'f':
            rect = drawing.get('rect')
            fill_color = drawing.get('fill', [0, 0, 0])
            seq_no = drawing.get('seqno', -1)

            if plan_type == "structural" and seq_no > 1000:
                continue
            
            # Filter by fill color based on plan type
            if abs(fill_color[0] - target_fill_color) > 0.001:
                continue
            
            if rect:
                width = abs(rect.x1 - rect.x0)
                height = abs(rect.y1 - rect.y0)
                
                # Filter by size constraints (10-20 units as per original logic)
                if width < 10 or height < 10 or width > 20 or height > 20:
                    continue

                if abs(width - 18.72) < 0.001 or abs(height - 18.72) < 0.001:
                    continue
                
                # Calculate center point
                center_x = (rect.x0 + rect.x1) / 2
                center_y = (rect.y0 + rect.y1) / 2
                
                column_data = {
                    "index": column_id,
                    "center": (center_x, center_y),
                    "center_x": center_x,
                    "center_y": center_y,
                    "width": width,
                    "height": height,
                    "plan_type": plan_type
                }
                
                columns.append(column_data)
                column_id += 1
    
    doc.close()
    print(f"Found {len(columns)} columns in {plan_type} plan")
    return columns


def extract_column_centers(pdf_path: str, page_number: int, sheet_title: str = None, sheet_type: str = None) -> List[Dict]:
    """
    Extract column centers from PDF page using appropriate method based on plan type
    
    Args:
        pdf_path: Path to the PDF file
        page_number: Page number (1-based)
        sheet_title: Title of the sheet for plan type detection
        sheet_type: Type of the sheet for plan type detection
        
    Returns:
        list: List of column center positions with metadata
    """
    # First detect the plan type from sheet type and title
    plan_type = detect_plan_type(sheet_title, sheet_type)
    print(f"Detected plan type: {plan_type} (from title: '{sheet_title}', type: '{sheet_type}')")
    
    # Use appropriate extraction method based on plan type
    if plan_type == "slab":
        return extract_column_centers_slab(pdf_path, page_number)
    elif plan_type in ["structural", "architectural"]:
        return extract_column_centers_floor_structural(pdf_path, page_number, plan_type)
    else:
        # Default to slab method for unknown types
        print("Using default slab extraction method for unknown plan type")
        return extract_column_centers_slab(pdf_path, page_number)


def save_columns_to_database(sheet_id: int, columns: List[Dict]) -> bool:
    """
    Save extracted columns to the database
    
    Args:
        sheet_id: ID of the sheet
        columns: List of column data dictionaries
        
    Returns:
        bool: True if successful, False otherwise
    """
    db = SessionLocal()
    try:
        # Clear existing columns for this sheet
        db.query(SheetColumn).filter(SheetColumn.sheet_id == sheet_id).delete()
        
        # Add new columns
        for column_data in columns:
            db_column = SheetColumn(
                sheet_id=sheet_id,
                column_index=column_data["index"],
                center_x=column_data["center_x"],
                center_y=column_data["center_y"],
                width=column_data["width"],
                height=column_data["height"]
            )
            db.add(db_column)
        
        db.commit()
        print(f"✅ Successfully saved {len(columns)} columns to database for sheet {sheet_id}")
        return True
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error saving columns to database: {e}")
        return False
    finally:
        db.close()


def extract_and_save_sheet_columns(sheet_id: int) -> Dict[str, any]:
    """
    Extract columns from a sheet and save to database
    
    Args:
        sheet_id: ID of the sheet to process
        
    Returns:
        dict: Result with success status and data
    """
    db = SessionLocal()
    try:
        # Get sheet information
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            return {"success": False, "error": f"Sheet {sheet_id} not found"}
        
        # Get document path
        document = db.query(Document).filter(Document.id == sheet.document_id).first()
        if not document or not document.path:
            return {"success": False, "error": f"Document path not found for sheet {sheet_id}"}
        
        pdf_path = document.path
        if not os.path.exists(pdf_path):
            return {"success": False, "error": f"PDF file not found: {pdf_path}"}
        
        # Extract columns using sheet title and type for plan type detection
        print(f"🔍 Extracting columns from {pdf_path}, page {sheet.page}")
        columns = extract_column_centers(pdf_path, sheet.page, sheet.title, sheet.type)
        
        if not columns:
            return {"success": True, "message": f"No columns found in sheet {sheet.code}", "columns": []}
        
        # Save to database
        success = save_columns_to_database(sheet_id, columns)
        if not success:
            return {"success": False, "error": "Failed to save columns to database"}
        
        return {
            "success": True,
            "message": f"Successfully extracted and saved {len(columns)} columns from sheet {sheet.code}",
            "columns": columns,
            "sheet_code": sheet.code
        }
        
    except Exception as e:
        print(f"❌ Error in extract_and_save_sheet_columns: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def get_sheet_columns(sheet_id: int) -> Dict[str, any]:
    """
    Get existing columns for a sheet from database
    
    Args:
        sheet_id: ID of the sheet
        
    Returns:
        dict: Result with columns data
    """
    db = SessionLocal()
    try:
        columns = db.query(SheetColumn).filter(SheetColumn.sheet_id == sheet_id).order_by(SheetColumn.column_index).all()
        
        column_data = []
        for column in columns:
            column_data.append({
                "id": column.id,
                "index": column.column_index,
                "center_x": column.center_x,
                "center_y": column.center_y,
                "width": column.width,
                "height": column.height,
                "created_at": column.created_at.isoformat()
            })
        
        return {
            "success": True,
            "columns": column_data,
            "count": len(column_data)
        }
        
    except Exception as e:
        print(f"❌ Error getting sheet columns: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()