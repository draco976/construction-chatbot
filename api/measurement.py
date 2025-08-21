#!/usr/bin/env python3
"""
Measurement Extraction Tool for ConcretePro Agent
Extracts dot detection and distance measurements from PDF pages
"""

import json
import os
import fitz
import math
import re
from collections import defaultdict
from typing import List, Dict, Tuple, Optional
from sqlalchemy.orm import Session
from database import Sheet, Document, SessionLocal


def join_strokes_and_find_midpoints(pdf_path: str, page_number: int):
    """
    Find dots (strokes) in PDF and return their positions with indices
    Based on position.py logic
    """
    doc, strokes = fitz.open(pdf_path), []

    print(f"Processing page {page_number} from {pdf_path}")

    for page in doc[page_number-1:page_number]:  # Process only the specified page (convert to 0-based)
        for p in page.get_drawings():
            if p.get("type") != 's':  # skip non-drawings
                continue

            if p.get('width', 0) < 1.1 or p.get('width', 10) > 1.3:  # Filter out very thin lines
                continue

            # check color is (0.0, 0.0, 0.0)
            if p.get("color") != (0.0, 0.0, 0.0):
                continue

            # Extract line segment points from the stroke
            items = p.get('items', [])
            if items and items[0][0] == 'l':  # line command
                start_point = items[0][1]
                end_point = items[0][2]
                strokes.append({
                    'start': (start_point.x, start_point.y),
                    'end': (end_point.x, end_point.y),
                    'used': False
                })

    print(f"Found {len(strokes)} stroke segments on page {page_number}")
    
    # Join strokes with common points
    joined_strokes = []
    
    for i, stroke in enumerate(strokes):
        if stroke['used']:
            continue
            
        # Start a new joined stroke
        current_stroke = [stroke['start'], stroke['end']]
        stroke['used'] = True
        
        # Keep looking for connecting strokes
        found_connection = True
        while found_connection:
            found_connection = False
            for j, other_stroke in enumerate(strokes):
                if other_stroke['used']:
                    continue

                tolerance = 0.001  # Tolerance for point matching
                    
                # Check if strokes connect
                if (abs(current_stroke[-1][0] - other_stroke['start'][0]) < tolerance and 
                    abs(current_stroke[-1][1] - other_stroke['start'][1]) < tolerance):
                    # Connect end to start
                    current_stroke.append(other_stroke['end'])
                    other_stroke['used'] = True
                    found_connection = True
                    break
                elif (abs(current_stroke[-1][0] - other_stroke['end'][0]) < tolerance and 
                      abs(current_stroke[-1][1] - other_stroke['end'][1]) < tolerance):
                    # Connect end to end (reverse other stroke)
                    current_stroke.append(other_stroke['start'])
                    other_stroke['used'] = True
                    found_connection = True
                    break
                elif (abs(current_stroke[0][0] - other_stroke['start'][0]) < tolerance and 
                      abs(current_stroke[0][1] - other_stroke['start'][1]) < tolerance):
                    # Connect start to start (prepend reversed)
                    current_stroke.insert(0, other_stroke['end'])
                    other_stroke['used'] = True
                    found_connection = True
                    break
                elif (abs(current_stroke[0][0] - other_stroke['end'][0]) < tolerance and 
                      abs(current_stroke[0][1] - other_stroke['end'][1]) < tolerance):
                    # Connect start to end
                    current_stroke.insert(0, other_stroke['start'])
                    other_stroke['used'] = True
                    found_connection = True
                    break
        
        joined_strokes.append(current_stroke)
    
    # Calculate midpoints of joined strokes
    out = []
    for stroke_points in joined_strokes:
        if len(stroke_points) >= 2:
            # Calculate the midpoint of the entire stroke path
            stroke_points = list(set(stroke_points))
            
            total_x = sum(point[0] for point in stroke_points)
            total_y = sum(point[1] for point in stroke_points)
            midpoint = (total_x / len(stroke_points), total_y / len(stroke_points))
            out.append({
                "position": midpoint,
                "stroke_points": stroke_points
            })
    
    # Remove duplicate positions - keep only one dot per unique position
    unique_dots = []
    seen_positions = set()
    
    for dot in out:
        pos_key = (round(dot["position"][0], 2), round(dot["position"][1], 2))
        if pos_key not in seen_positions:
            unique_dots.append(dot)
            seen_positions.add(pos_key)
    
    # Sort dots by leftmost (x) first, then uppermost (y)
    unique_dots.sort(key=lambda dot: (dot["position"][0], dot["position"][1]))
    
    # Assign indices starting from 0
    for i, dot in enumerate(unique_dots):
        dot["index"] = i
    
    doc.close()
    print(f"Found {len(strokes)} total stroke segments, joined into {len(unique_dots)} unique positions")
    return unique_dots


DIST_RE = re.compile(r"(?:\d+'\s*-\s*)?\d+(?:\s+\d+/\d+)?\"")

def find_distance_text(pdf_path: str, page_number: int):
    """
    Find distance text (measurements) in PDF
    Based on position.py logic
    """
    doc, out = fitz.open(pdf_path), []
    for page in doc[page_number-1:page_number]:  # Process only the specified page (convert to 0-based)
        for b in page.get_text("dict")["blocks"]:
            if "lines" not in b:  # skip non-text blocks
                continue
            for l in b["lines"]:
                for s in l["spans"]:
                    if "\"" not in s["text"]:
                        continue
                    for piece in DIST_RE.findall(s["text"]):
                        out.append({"text": piece, "bbox": s["bbox"], "dir": "horizontal" if l["dir"][0] == 1.0 else "vertical"})  # bbox is now approximate
    
    doc.close()
    return out


def group_dots_by_vertical_position(dots, tolerance=0.05):
    """Group dots by their vertical position (y-coordinate) with tolerance"""
    groups = defaultdict(list)
    
    for dot in dots:
        y_coord = dot["position"][1]
        # Find existing group within tolerance
        found_group = False
        for group_y in groups.keys():
            if abs(y_coord - group_y) <= tolerance:
                groups[group_y].append(dot)
                found_group = True
                break
        
        if not found_group:
            groups[y_coord] = [dot]
    
    return groups


def group_dots_by_horizontal_position(dots, tolerance=0.05):
    """Group dots by their horizontal position (x-coordinate) with tolerance"""
    groups = defaultdict(list)
    
    for dot in dots:
        x_coord = dot["position"][0]
        # Find existing group within tolerance
        found_group = False
        for group_x in groups.keys():
            if abs(x_coord - group_x) <= tolerance:
                groups[group_x].append(dot)
                found_group = True
                break
        
        if not found_group:
            groups[x_coord] = [dot]
    
    return groups


def sort_dots_by_x_position(dots_group):
    """Sort dots in a group from left to right (by x-coordinate)"""
    return sorted(dots_group, key=lambda dot: dot["position"][0])


def sort_dots_by_y_position(dots_group):
    """Sort dots in a group from top to bottom (by y-coordinate)"""
    return sorted(dots_group, key=lambda dot: dot["position"][1])


def parse_distance_to_inches(distance_text: str):
    """
    Convert architectural distance strings to total inches (float).
    Based on distance.py logic
    """
    if not distance_text:
        return None

    # ---- Normalise & clean --------------------------------------------------
    txt = (distance_text
           .replace('″', '"')     # smart inch mark → "
           .replace('"', '"')
           .replace(''', "'")
           .replace(''', "'")
           .replace('"', '')      # strip inch mark
           .strip())
    txt = re.sub(r'\s+', ' ', txt)  # collapse multiple spaces

    # ---- Regex: [feet] [' ] [-] [whole] [fraction] --------------------------
    pattern = re.compile(r"""
        ^\s*
        (?:(\d+)\s*')?            # 1: feet (optional)
        \s*-?\s*                  #    optional dash separator
        (?:
            (\d+)\s*              # 2: whole‑inch part
            (?:\s+(\d+)\s*/\s*(\d+))?  # 3&4: fractional part (optional)
          |
            (\d+)\s*/\s*(\d+)          # 5&6: fraction that stands alone
        )?
        \s*$
        """, re.VERBOSE)

    m = pattern.match(txt)
    if not m:
        return None

    feet = int(m.group(1)) if m.group(1) else 0
    inches = 0.0

    if m.group(2):                         # whole inches [+ optional fraction]
        inches = float(m.group(2))
        if m.group(3) and m.group(4):
            inches += int(m.group(3)) / int(m.group(4))
    elif m.group(5) and m.group(6):        # fraction‑only inches
        inches = int(m.group(5)) / int(m.group(6))

    return feet * 12 + inches


def find_all_texts_between_dots(dot1, dot2, texts, tolerance=50):
    """Find all texts within radius and filter by bbox orientation"""
    x1, y1 = dot1["position"]
    x2, y2 = dot2["position"]
    
    # Calculate midpoint between dots
    mid_x = (x1 + x2) / 2
    mid_y = (y1 + y2) / 2
    
    # Determine if this is a horizontal or vertical line
    is_horizontal = abs(y1 - y2) < abs(x1 - x2)
    
    valid_texts = []
    
    for text in texts:
        text_bbox = text["bbox"]
        text_center = ((text_bbox[0] + text_bbox[2]) / 2, 
                       (text_bbox[1] + text_bbox[3]) / 2)

        text_x, text_y = text_center
        
        # Calculate distance from text center to midpoint
        distance = math.sqrt((text_x - mid_x)**2 + (text_y - mid_y)**2)
        
        # Check if text is within tolerance
        if distance <= tolerance:
            # Check bbox orientation
            bbox_width = text_bbox[2] - text_bbox[0]
            bbox_height = text_bbox[3] - text_bbox[1]
            text_is_horizontal = (text["dir"] == "horizontal")

            # For horizontal dots, prefer horizontal text (and vice versa)
            if is_horizontal == text_is_horizontal:
                # Try to parse as distance measurement
                inches = parse_distance_to_inches(text["text"])
                if inches is not None:
                    valid_texts.append({
                        "text": text["text"],
                        "inches": inches,
                        "distance_to_midpoint": distance,
                        "bbox": text_bbox
                    })
    
    # Sort by distance to midpoint
    valid_texts.sort(key=lambda x: x["distance_to_midpoint"])
    
    return valid_texts


def calculate_distance_between_dots(dot1, dot2):
    """Calculate Euclidean distance between two dots"""
    x1, y1 = dot1["position"]
    x2, y2 = dot2["position"]
    return math.sqrt((x2 - x1)**2 + (y2 - y1)**2)


def calculate_scale_from_pairs(dot_pairs_with_single_measurement):
    """Calculate pixel-to-inch scale from pairs with only one measurement"""
    scales = []
    
    for pair_data in dot_pairs_with_single_measurement:
        pixel_distance = pair_data["pixel_distance"]
        measurement_inches = pair_data["measurements"][0]["inches"]
        
        if measurement_inches > 0:  # Avoid division by zero
            scale = pixel_distance / measurement_inches
            scales.append(scale)

    scales = [round(s, 2) for s in scales if s > 0]  # Round and filter out non-positive scales
    
    if scales:
        # Use mode to find the most common scale
        from statistics import mode
        try:
            return mode(scales)
        except Exception as e:
            print(f"Error calculating mode: {e}")
            # If mode fails, return the average scale
            return sum(scales) / len(scales)
    else:
        print("No valid scales found")

    return None

def select_best_measurement_by_scale(measurements, pixel_distance, target_scale):
    """Select the measurement that best matches the target scale"""
    if not measurements:
        return None
    
    if len(measurements) == 1:
        return measurements[0]
    
    best_measurement = None
    best_scale_diff = float('inf')
    
    for measurement in measurements:
        if measurement["inches"] > 0:
            measurement_scale = pixel_distance / measurement["inches"]
            scale_diff = abs(measurement_scale - target_scale)
            
            if scale_diff < best_scale_diff:
                best_scale_diff = scale_diff
                best_measurement = measurement
    
    return best_measurement if best_measurement else measurements[0]

def calculate_distances_from_dots_and_text(dots, texts):
    """
    Calculate distances between dot pairs and associate with text measurements
    Based on distance.py logic
    """
    all_dot_pairs = []
    
    # Process vertical groups (horizontal lines - dots with same Y coordinate)
    print("Grouping dots by vertical position (horizontal lines)...")
    vertical_groups = group_dots_by_vertical_position(dots)
    
    for group_y, dots_in_group in vertical_groups.items():
        if len(dots_in_group) < 2:
            continue  # Skip groups with less than 2 dots
        
        # Sort dots from left to right
        sorted_dots = sort_dots_by_x_position(dots_in_group)
        
        # Process adjacent pairs
        for i in range(len(sorted_dots) - 1):
            dot1 = sorted_dots[i]
            dot2 = sorted_dots[i + 1]
            
            # Find all valid measurements for this pair
            measurements = find_all_texts_between_dots(dot1, dot2, texts)
            
            # Calculate actual distance between dots
            pixel_distance = calculate_distance_between_dots(dot1, dot2)
            
            pair_data = {
                "dot1": dot1,
                "dot2": dot2,
                "measurements": measurements,
                "pixel_distance": pixel_distance,
                "group_type": "horizontal_line",
                "group_coordinate": round(group_y, 2)
            }
            
            all_dot_pairs.append(pair_data)
    
    # Process horizontal groups (vertical lines - dots with same X coordinate)
    print("Grouping dots by horizontal position (vertical lines)...")
    horizontal_groups = group_dots_by_horizontal_position(dots)
    
    for group_x, dots_in_group in horizontal_groups.items():
        if len(dots_in_group) < 2:
            continue  # Skip groups with less than 2 dots
        
        # Sort dots from top to bottom
        sorted_dots = sort_dots_by_y_position(dots_in_group)
        
        # Process adjacent pairs
        for i in range(len(sorted_dots) - 1):
            dot1 = sorted_dots[i]
            dot2 = sorted_dots[i + 1]
            
            # Find all valid measurements for this pair
            measurements = find_all_texts_between_dots(dot1, dot2, texts)
            
            # Calculate actual distance between dots
            pixel_distance = calculate_distance_between_dots(dot1, dot2)
            
            pair_data = {
                "dot1": dot1,
                "dot2": dot2,
                "measurements": measurements,
                "pixel_distance": pixel_distance,
                "group_type": "vertical_line",
                "group_coordinate": round(group_x, 2)
            }
            
            all_dot_pairs.append(pair_data)

    single_measurement_pairs = [pair for pair in all_dot_pairs if len(pair["measurements"]) == 1]
    target_scale = calculate_scale_from_pairs(single_measurement_pairs)
    
    if target_scale:
        print(f"Calculated scale: {target_scale:.2f} pixels per inch")
    else:
        print("Warning: Could not calculate scale, using closest measurement for each pair")
    
    # Create distance results
    results = []
    
    for pair_data in all_dot_pairs:
        dot1 = pair_data["dot1"]
        dot2 = pair_data["dot2"]
        measurements = pair_data["measurements"]
        pixel_distance = pair_data["pixel_distance"]
        
        if not measurements:
            # No measurements found
            selected_text = "no distance found"
            measurement_inches = None
            confidence_score = 0
        else:
            # Multiple measurements - select best one based on scale
            if target_scale:
                best_measurement = select_best_measurement_by_scale(measurements, pixel_distance, target_scale)
                selected_text = best_measurement["text"]
                measurement_inches = best_measurement["inches"]
                
                # Calculate confidence based on how well this measurement matches the scale
                measurement_scale = pixel_distance / measurement_inches if measurement_inches > 0 else 0
                scale_error = abs(measurement_scale - target_scale) / target_scale if target_scale > 0 else 1
                confidence_score = max(0, 1 - scale_error)
            else:
                # Use closest measurement
                selected_text = measurements[0]["text"]
                measurement_inches = measurements[0]["inches"]
                confidence_score = 0.5

        if confidence_score > 0.9:
            
            result = {
                "pointA": f"{dot1['position'][0]},{dot1['position'][1]}",
                "pointB": f"{dot2['position'][0]},{dot2['position'][1]}",
                "pointA_id": dot1['index'],
                "pointB_id": dot2['index'],
                "length": measurement_inches,
                "pixel_distance": round(pixel_distance, 2),
                "distance_text": selected_text,
                "group_type": pair_data["group_type"],
                "confidence_score": round(confidence_score, 3)
            }
            
            results.append(result)

    print(f"Found {len(results)} distance measurements between dots")
    return results


def extract_measurements_from_sheet(sheet_id: int) -> Dict:
    """
    Extract distance measurements from a sheet
    
    Args:
        sheet_id: ID of the sheet to process
        
    Returns:
        dict: Result with success status and measurement data
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
        
        print(f"🔍 Extracting measurements from {pdf_path}, page {sheet.page}")
        
        # Extract measurements
        dots = join_strokes_and_find_midpoints(pdf_path, sheet.page)
        texts = find_distance_text(pdf_path, sheet.page)
        distances = calculate_distances_from_dots_and_text(dots, texts)
        
        return {
            "success": True,
            "sheet_info": {
                "id": sheet.id,
                "code": sheet.code,
                "title": sheet.title,
                "page": sheet.page
            },
            "measurements": {
                "dots_count": len(dots),
                "texts_count": len(texts),
                "distances_count": len(distances),
                "dots": dots,
                "texts": texts,
                "distances": distances
            }
        }
        
    except Exception as e:
        print(f"❌ Error extracting measurements: {e}")
        return {"success": False, "error": str(e)}
    finally:
        db.close()


def extract_measurements_from_pdf(pdf_path: str, page_number: int) -> Dict:
    """
    Extract distance measurements from a PDF page directly
    
    Args:
        pdf_path: Path to the PDF file
        page_number: Page number (1-based)
        
    Returns:
        dict: Results containing dots, texts, and distance measurements
    """
    try:
        print(f"🔍 Extracting measurements from {pdf_path}, page {page_number}")
        
        # Detect dots
        dots = join_strokes_and_find_midpoints(pdf_path, page_number)
        
        # Find distance text
        texts = find_distance_text(pdf_path, page_number)
        
        # Calculate distances
        distances = calculate_distances_from_dots_and_text(dots, texts)
        
        return {
            "success": True,
            "pdf_path": pdf_path,
            "page_number": page_number,
            "measurements": {
                "dots_count": len(dots),
                "texts_count": len(texts),
                "distances_count": len(distances),
                "dots": dots,
                "texts": texts,
                "distances": distances
            }
        }
        
    except Exception as e:
        print(f"❌ Error extracting measurements: {e}")
        return {"success": False, "error": str(e)}