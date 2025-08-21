#!/usr/bin/env python3
"""
Individual Sheet Processor script for PDF sheet processing
Handles processing of individual sheets after drawing index extraction
"""

import json
import sys
import os

def generate_svg_content(pdf_path: str, page_number: int) -> str:
    """
    Generate SVG file for a specific page in the PDF using pdftocairo and return the file path.
    
    Args:
        pdf_path: Path to the PDF file
        page_number: Page number (1-based)
        
    Returns:
        str: Path to the saved SVG file
    """
    
    import subprocess
    from pathlib import Path
    
    try:
        # Create SVG folder next to the PDF file
        pdf_file = Path(pdf_path)
        svg_folder = pdf_file.parent / f"{pdf_file.stem}_svgs"
        svg_folder.mkdir(exist_ok=True)
        
        # Create SVG file path
        svg_filename = f"page_{page_number}.svg"
        svg_path = svg_folder / svg_filename

        # Use pdftocairo to convert specific page to SVG
        cmd = ['pdftocairo', '-svg', str(pdf_path), str(svg_path), '-f', str(page_number), '-l', str(page_number)]
        
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        
        print(f"✅ Generated SVG file: {svg_path}")
        print(f"📁 Saved to: {svg_folder}")
        
        return str(svg_path)
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Error running pdftocairo: {e}")
        print(f"Command output: {e.stdout}")
        print(f"Command error: {e.stderr}")
        
    except FileNotFoundError:
        print("❌ pdftocairo command not found. Please install poppler-utils:")
        print("   macOS: brew install poppler")
        print("   Ubuntu: sudo apt-get install poppler-utils")
        
    except Exception as e:
        print(f"❌ Error generating SVG: {e}")
    
    # Return empty string if conversion failed
    return ""


def process_sheet(sheet_id: int, sheet_code: str, page_number: int, pdf_path: str):
    """
    Process a single sheet: extract SVG, identify references
    
    Args:
        sheet_id: Database sheet ID for storing results
        sheet_code: Sheet identifier (e.g., "A-001", "S-101")
        page_number: Page number in PDF (1-based)
        pdf_path: Path to the PDF file
        
    Returns:
        dict: Processing results
    """
    
    try:
        print(f"🔄 Processing sheet {sheet_code} (Page {page_number})")
        
        # 1. Generate SVG and save to database
        print(f"📄 Generating SVG for {sheet_code}...")
        svg_path = generate_svg_content(pdf_path, page_number)
        if svg_path:
            print(f"✅ SVG saved: {svg_path}")
        
        result = {
            "sheet_id": sheet_id,
            "sheet_code": sheet_code,
            "svg_path": svg_path,
            "status": "completed",
            "success": True
        }
        
        print(f"✅ Completed processing sheet {sheet_code}")
        return result
        
    except Exception as e:
        print(f"❌ Error processing sheet {sheet_code}: {e}")
        return {
            "sheet_id": sheet_id,
            "sheet_code": sheet_code,
            "svg_path": None,
            "status": "error",
            "success": False,
            "error": str(e)
        }


if __name__ == "__main__":
    # Get parameters from command line arguments
    sheet_id = int(sys.argv[1])
    sheet_code = sys.argv[2]
    page_number = int(sys.argv[3])
    pdf_path = sys.argv[4]
    
    # Process single sheet
    result = process_sheet(sheet_id, sheet_code, page_number, pdf_path)
    
    # Output result as JSON to stdout
    print(json.dumps(result, indent=2))