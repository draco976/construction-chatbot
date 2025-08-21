"""
Multiprocessing worker functions for sheet processing.
These functions are in a separate module to avoid pickling issues.
"""
import os
from typing import Dict


def process_single_sheet_worker(sheet_data: dict, pdf_path: str) -> Dict:
    """Worker function to process a single sheet - designed for multiprocessing"""
    from database import SessionLocal, Sheet
    from sheet_processor import process_sheet
    
    # Create a fresh database connection for this process
    db = SessionLocal()
    try:
        sheet_id = sheet_data["id"]
        sheet_code = sheet_data["code"]
        sheet_page = sheet_data["page"]
        
        print(f"🔄 Worker processing sheet {sheet_code} (PID: {os.getpid()})")
        
        # Update status to processing
        db_sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not db_sheet:
            return {
                "sheet_id": sheet_id,
                "success": False,
                "error": f"Sheet {sheet_id} not found in database"
            }
        
        db_sheet.status = "processing"
        db.commit()
        
        # Process the sheet (CPU intensive operation)
        result = process_sheet(sheet_id, sheet_code, sheet_page, pdf_path)
        
        # Update the database with results
        if result.get("success") and result.get("svg_path"):
            db_sheet.svg_path = result["svg_path"]
            db_sheet.status = "completed"
            print(f"✅ Worker: Sheet {sheet_code} completed (PID: {os.getpid()})")
            db.commit()
            return {
                "sheet_id": sheet_id,
                "sheet_code": sheet_code,
                "success": True,
                "svg_path": result["svg_path"]
            }
        else:
            db_sheet.status = "error"
            db.commit()
            return {
                "sheet_id": sheet_id,
                "sheet_code": sheet_code,
                "success": False,
                "error": f"Failed to process sheet {sheet_code}"
            }
            
    except Exception as e:
        print(f"❌ Worker error processing sheet {sheet_data.get('code', 'unknown')}: {e}")
        # Update status to error
        try:
            db_sheet = db.query(Sheet).filter(Sheet.id == sheet_data["id"]).first()
            if db_sheet:
                db_sheet.status = "error"
                db.commit()
        except Exception as update_error:
            print(f"❌ Failed to update error status: {update_error}")
        
        return {
            "sheet_id": sheet_data["id"],
            "sheet_code": sheet_data.get("code", "unknown"),
            "success": False,
            "error": str(e)
        }
    finally:
        db.close()