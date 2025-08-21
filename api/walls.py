#!/usr/bin/env python3
"""
Wall Extraction for ConcretePro
Extracts wall positions and orientations from PDF construction drawings
"""

import fitz
import os
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from database import Sheet, Document, SheetWall, SessionLocal


def extract_concrete_walls(pdf_path: str, page_number: int) -> List[Dict[str, Any]]:
    """Extract concrete walls from a PDF page"""
    doc = fitz.open(pdf_path)
    
    if page_number > len(doc):
        print(f"Error: Page {page_number} does not exist. PDF has {len(doc)} pages.")
        doc.close()
        return []
    
    page = doc[page_number - 1]  # Convert to 0-based
    drawings = page.get_drawings()
    
    print(f"  Processing walls on page {page_number}: Found {len(drawings)} total drawings")
    
    walls = []
    wall_count = 0
    
    # Process each drawing to find walls
    for i, drawing in enumerate(drawings):
        drawing_type = drawing.get('type', 'Unknown')
        
        # Check if drawing type is 'f' (filled) - walls are filled shapes
        if drawing_type == 'f':
            rect = drawing.get('rect')
            fill_color = drawing.get('fill', [0, 0, 0])
            
            # Filter by fill color (0.753 same as columns)
            if abs(fill_color[0] - 0.753) > 0.001:
                continue
            
            if rect:
                width = abs(rect.x1 - rect.x0)
                height = abs(rect.y1 - rect.y0)
                
                # Wall characteristics:
                # 1. One side is much longer than the other (aspect ratio check)
                # 2. Shorter side is between 12-30 units
                shorter_side = min(width, height)
                longer_side = max(width, height)
                
                # Check if shorter side is in the valid range
                if shorter_side < 12 or shorter_side > 30:
                    continue

                if abs(longer_side - 90) < 0.01:
                    continue
                
                # Check aspect ratio - longer side should be significantly longer
                aspect_ratio = longer_side / shorter_side if shorter_side > 0 else 0
                if aspect_ratio < 5.0:  # Wall should be at least 5x longer than it is wide
                    continue
                
                # Calculate center point
                center_x = (rect.x0 + rect.x1) / 2
                center_y = (rect.y0 + rect.y1) / 2
                
                # Determine orientation
                orientation = "horizontal" if width > height else "vertical"
                
                wall_data = {
                    "index": wall_count,
                    "center": (center_x, center_y),
                    "center_x": center_x,
                    "center_y": center_y,
                    "width": width,
                    "height": height,
                    "shorter_side": shorter_side,
                    "longer_side": longer_side,
                    "aspect_ratio": round(aspect_ratio, 2),
                    "orientation": orientation,
                    "thickness": shorter_side,
                    "length": longer_side,
                    "rect": {
                        "x0": rect.x0,
                        "y0": rect.y0, 
                        "x1": rect.x1,
                        "y1": rect.y1
                    }
                }
                
                walls.append(wall_data)
                wall_count += 1
    
    doc.close()
    print(f"  Found {len(walls)} concrete walls on page {page_number}")
    return walls


def save_walls_to_database(sheet_id: int, walls: List[Dict[str, Any]]) -> int:
    """Save extracted walls to database"""
    db = SessionLocal()
    try:
        # Delete existing walls for this sheet
        db.query(SheetWall).filter(SheetWall.sheet_id == sheet_id).delete()
        
        # Insert new walls
        saved_count = 0
        for wall in walls:
            sheet_wall = SheetWall(
                sheet_id=sheet_id,
                index=wall['index'],
                center_x=wall['center_x'],
                center_y=wall['center_y'],
                width=wall['width'],
                height=wall['height'],
                orientation=wall['orientation'],
                thickness=wall['thickness'],
                length=wall['length'],
                aspect_ratio=wall['aspect_ratio']
            )
            db.add(sheet_wall)
            saved_count += 1
        
        db.commit()
        print(f"✅ Saved {saved_count} walls to database")
        return saved_count
        
    except Exception as e:
        print(f"❌ Error saving walls to database: {e}")
        db.rollback()
        return 0
    finally:
        db.close()


def extract_and_save_sheet_walls(sheet_id: int) -> Dict[str, Any]:
    """Extract walls from a sheet and save to database"""
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
        
        print(f"🧱 Extracting walls from {pdf_path}, page {sheet.page}")
        
        # Extract walls
        walls = extract_concrete_walls(pdf_path, sheet.page)
        
        # Save to database
        saved_count = save_walls_to_database(sheet_id, walls)
        
        return {
            "success": True,
            "sheet_info": {
                "id": sheet.id,
                "code": sheet.code,
                "title": sheet.title,
                "page": sheet.page
            },
            "walls_found": len(walls),
            "walls_saved": saved_count,
            "walls": walls
        }
        
    except Exception as e:
        print(f"❌ Error extracting walls: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def get_sheet_walls(sheet_id: int) -> Dict[str, Any]:
    """Get saved walls for a sheet from database"""
    db = SessionLocal()
    try:
        walls = db.query(SheetWall).filter(SheetWall.sheet_id == sheet_id).order_by(SheetWall.index).all()
        
        walls_data = []
        for wall in walls:
            walls_data.append({
                "id": wall.id,
                "index": wall.index,
                "center_x": wall.center_x,
                "center_y": wall.center_y,
                "width": wall.width,
                "height": wall.height,
                "orientation": wall.orientation,
                "thickness": wall.thickness,
                "length": wall.length,
                "aspect_ratio": wall.aspect_ratio,
                "created_at": wall.created_at.isoformat() if wall.created_at else None
            })
        
        return {
            "success": True,
            "count": len(walls_data),
            "walls": walls_data
        }
        
    except Exception as e:
        print(f"❌ Error getting walls: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()