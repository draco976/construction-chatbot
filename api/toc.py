#!/usr/bin/env python3
"""
TOC (Table of Contents) Processor script for PDF processing
Extracts sheet information from PDF table of contents
"""

import code
import json
import sys
import pymupdf  # PyMuPDF for PDF processing


def extract_from_toc(doc, document_id):
    """Extract sheet information from PDF table of contents"""
    toc = doc.get_toc()
    extracted_sheets = []
    
    if not toc:
        return extracted_sheets
    
    for entry in toc:
        level, title, page_number = entry
        
        if " - " in title:
            parts = title.split(" - ", 1)
            code = parts[0].strip()
            clean_title = parts[1].strip()
            
            # Check if it looks like a sheet code (has both letters and numbers)
            if any(c.isdigit() for c in code) and any(c.isalpha() for c in code):
                # pick the leading alphabetic characters and convert to uppercase before the . and numbers
                leading_letters = ''
                for c in code:
                    if c.isalpha():
                        leading_letters += c.upper()
                    else:
                        break

                if leading_letters not in ['A', 'S', 'C']:
                    continue

                # code_list = ['A2.11', 'A2.12', 'A2.13', 'A2.14', 'A2.15', 'A2.16', 'A2.17']
                # code_list += ['A2.70', 'A7.11', 'A7.12', 'A7.13', 'A7.14', 'A7.15', 'A7.16', 'A7.40', 'A7.41']

                # if code not in code_list:
                #     continue

                sheet_data = {
                    'code': code,
                    'title': clean_title,
                    'type': leading_letters,
                    'page': page_number,
                    'documentId': document_id
                }
                
                extracted_sheets.append(sheet_data)
    
    return extracted_sheets


def process_pdf_toc(pdf_path, document_id):
    """Main function to extract TOC from PDF"""
    try:
        doc = pymupdf.open(pdf_path)
        
        # Extract sheet information from TOC
        sheets = extract_from_toc(doc, document_id)
        
        doc.close()
        
        result = {
            'success': True,
            'sheets': sheets,
            'total_sheets': len(sheets)
        }
        
        return result
    
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({
            'success': False,
            'error': 'Usage: python toc.py <pdf_path> <document_id>'
        }))
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    document_id = int(sys.argv[2])
    
    result = process_pdf_toc(pdf_path, document_id)
    print(json.dumps(result, indent=2))