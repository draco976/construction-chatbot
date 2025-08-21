"""
Grid line extraction utility for construction drawings
"""
import fitz
import os
import re
from typing import List, Dict, Tuple
from sqlalchemy.orm import Session
from database import SheetGridLine, Sheet, Document, Project, SessionLocal


def extract_grid_line_labels(pdf_path: str, page_number: int) -> List[Dict]:
    """
    Extract grid line labels from PDF page based on text patterns
    
    Args:
        pdf_path: Path to the PDF file
        page_number: Page number (1-based)
        
    Returns:
        list: List of grid line label positions with metadata
    """
    doc = fitz.open(pdf_path)
    
    if page_number > len(doc):
        print(f"Error: Page {page_number} does not exist. PDF has {len(doc)} pages.")
        doc.close()
        return []
    
    page = doc[page_number - 1]  # Convert to 0-based
    text_instances = page.get_text("dict")
    
    print(f"Processing page {page_number} for grid line labels")
    
    grid_lines = []
    
    # Define patterns for different building types
    patterns = {
        'hotel': {
            'vertical': re.compile(r'^H\d+(?:\.\d+)?$'),  # H1, H2, H1.5, H1.7, etc.
            'horizontal': re.compile(r'^H[A-Z]$')        # HA, HB, HC, etc.
        },
        'residence': {
            'vertical': re.compile(r'^R\d+(?:\.\d+)?$'),  # R1, R2, R1.3, etc.
            'horizontal': re.compile(r'^R[A-Z]$')        # RA, RB, RC, etc.
        }
    }
    
    # Process text blocks to find grid line labels
    for block in text_instances["blocks"]:
        if "lines" in block:
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"].strip()
                    bbox = span["bbox"]  # (x0, y0, x1, y1)
                    
                    # Calculate center and dimensions
                    center_x = (bbox[0] + bbox[2]) / 2
                    center_y = (bbox[1] + bbox[3]) / 2
                    bbox_width = bbox[2] - bbox[0]
                    bbox_height = bbox[3] - bbox[1]
                    
                    # Check against patterns
                    for category, category_patterns in patterns.items():
                        for orientation, pattern in category_patterns.items():
                            if pattern.match(text):
                                grid_line_data = {
                                    "label": text,
                                    "category": category,
                                    "orientation": orientation,
                                    "center_x": center_x,
                                    "center_y": center_y,
                                    "bbox_width": bbox_width,
                                    "bbox_height": bbox_height
                                }
                                
                                grid_lines.append(grid_line_data)
                                print(f"Found {category} {orientation} grid line: {text} at ({center_x:.1f}, {center_y:.1f})")
                                break
                        else:
                            continue
                        break
    
    doc.close()
    print(f"Found {len(grid_lines)} grid line labels")
    return grid_lines


def save_grid_lines_to_database(sheet_id: int, grid_lines: List[Dict]) -> bool:
    """
    Save extracted grid lines to the database
    
    Args:
        sheet_id: ID of the sheet
        grid_lines: List of grid line data dictionaries
        
    Returns:
        bool: True if successful, False otherwise
    """
    db = SessionLocal()
    try:
        # Clear existing grid lines for this sheet
        db.query(SheetGridLine).filter(SheetGridLine.sheet_id == sheet_id).delete()
        
        # Add new grid lines
        for grid_line_data in grid_lines:
            db_grid_line = SheetGridLine(
                sheet_id=sheet_id,
                label=grid_line_data["label"],
                category=grid_line_data["category"],
                orientation=grid_line_data["orientation"],
                center_x=grid_line_data["center_x"],
                center_y=grid_line_data["center_y"],
                bbox_width=grid_line_data["bbox_width"],
                bbox_height=grid_line_data["bbox_height"]
            )
            db.add(db_grid_line)
        
        db.commit()
        print(f"✅ Successfully saved {len(grid_lines)} grid lines to database for sheet {sheet_id}")
        return True
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error saving grid lines to database: {e}")
        return False
    finally:
        db.close()


def extract_and_save_sheet_grid_lines(sheet_id: int) -> Dict[str, any]:
    """
    Extract grid lines from a sheet and save to database
    
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
        
        # Extract grid lines
        print(f"🔍 Extracting grid lines from {pdf_path}, page {sheet.page}")
        grid_lines = extract_grid_line_labels(pdf_path, sheet.page)
        
        if not grid_lines:
            return {"success": True, "message": f"No grid lines found in sheet {sheet.code}", "grid_lines": []}
        
        # Save to database
        success = save_grid_lines_to_database(sheet_id, grid_lines)
        if not success:
            return {"success": False, "error": "Failed to save grid lines to database"}
        
        return {
            "success": True,
            "message": f"Successfully extracted and saved {len(grid_lines)} grid lines from sheet {sheet.code}",
            "grid_lines": grid_lines,
            "sheet_code": sheet.code
        }
        
    except Exception as e:
        print(f"❌ Error in extract_and_save_sheet_grid_lines: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def get_sheet_grid_lines(sheet_id: int) -> Dict[str, any]:
    """
    Get existing grid lines for a sheet from database
    
    Args:
        sheet_id: ID of the sheet
        
    Returns:
        dict: Result with grid lines data
    """
    db = SessionLocal()
    try:
        grid_lines = db.query(SheetGridLine).filter(SheetGridLine.sheet_id == sheet_id).order_by(SheetGridLine.label).all()
        
        grid_line_data = []
        for grid_line in grid_lines:
            grid_line_data.append({
                "id": grid_line.id,
                "label": grid_line.label,
                "category": grid_line.category,
                "orientation": grid_line.orientation,
                "center_x": grid_line.center_x,
                "center_y": grid_line.center_y,
                "bbox_width": grid_line.bbox_width,
                "bbox_height": grid_line.bbox_height,
                "created_at": grid_line.created_at.isoformat()
            })
        
        return {
            "success": True,
            "grid_lines": grid_line_data,
            "count": len(grid_line_data)
        }
        
    except Exception as e:
        print(f"❌ Error getting sheet grid lines: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()