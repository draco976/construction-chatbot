import json
import numpy as np
from PIL import Image
import fitz
import cv2
from scipy.spatial import cKDTree
from scipy.spatial.distance import cdist
from scipy.optimize import linear_sum_assignment
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import re
import os
import easyocr

def parse_elevation_text(el_text):
    """Parse elevation text and convert to total inches"""
    # Clean up the text first
    text = el_text.upper().replace('EL.', '').strip()
    
    # Handle positive/negative signs
    is_negative = False
    if text.startswith('+'):
        text = text[1:].strip()
    elif text.startswith('-'):
        is_negative = True
        text = text[1:].strip()
    
    total_inches = 0
    
    # Pattern 1: "0-0"" or "0-1 3/4""
    pattern1 = r"(\d+)-(\d+)(?:\s+(\d+)/(\d+))?\""
    match1 = re.search(pattern1, text)
    if match1:
        feet = int(match1.group(1))
        inches = int(match1.group(2))
        total_inches = feet * 12 + inches
        
        # Add fraction if present
        if match1.group(3) and match1.group(4):
            fraction_num = int(match1.group(3))
            fraction_den = int(match1.group(4))
            total_inches += fraction_num / fraction_den
    
    # Pattern 2: "0' -1 1/4"" (feet with negative inches)
    elif "'" in text:
        # Split by apostrophe
        parts = text.split("'")
        if len(parts) >= 2:
            feet = int(parts[0].strip()) if parts[0].strip().isdigit() else 0
            inch_part = parts[1].strip()
            
            # Handle negative inches part
            inch_negative = False
            if inch_part.startswith('-'):
                inch_negative = True
                inch_part = inch_part[1:].strip()
            
            # Parse inches with potential fractions
            inch_pattern = r"(\d+)(?:\s+(\d+)/(\d+))?"
            inch_match = re.search(inch_pattern, inch_part.replace('"', ''))
            if inch_match:
                inches = int(inch_match.group(1))
                if inch_match.group(2) and inch_match.group(3):
                    fraction_num = int(inch_match.group(2))
                    fraction_den = int(inch_match.group(3))
                    inches += fraction_num / fraction_den
                
                if inch_negative:
                    inches = -inches
                
                total_inches = feet * 12 + inches
    
    # Pattern 3: Standard "100'-6""
    else:
        pattern3 = r"(\d+)'-(\d+)(?:\s+(\d+)/(\d+))?\""
        match3 = re.search(pattern3, text)
        if match3:
            feet = int(match3.group(1))
            inches = int(match3.group(2))
            total_inches = feet * 12 + inches
            
            # Add fraction if present
            if match3.group(3) and match3.group(4):
                fraction_num = int(match3.group(3))
                fraction_den = int(match3.group(4))
                total_inches += fraction_num / fraction_den
    
    # Apply negative sign if needed
    if is_negative:
        total_inches = -total_inches
    
    # Return formatted result
    if total_inches == int(total_inches):
        return str(int(total_inches))
    else:
        return f"{total_inches:.2f}"

def parse_door_text(door_text):
    """Parse door text like 'DOOR (P5 45° 1.00)' to extract degree"""
    # Regex to match patterns like "45°" or "-45°"
    # Looks for: optional minus sign, digits, and degree symbol
    pattern = r"(-?\d+)°"
    
    match = re.search(pattern, door_text)
    if match:
        degree = match.group(1)
        return f"{degree}°"
    else:
        # If no match, return original text
        return door_text

def extract_door_degree(door_text):
    """Extract just the numeric degree value from door text"""
    pattern = r"(-?\d+)°"
    match = re.search(pattern, door_text)
    if match:
        return int(match.group(1))
    else:
        return 0  # Default to 0 degrees if no match

def rotate_image(image, angle):
    """Rotate image by given angle in degrees"""
    # Use the angle directly - positive for clockwise, negative for counter-clockwise
    return image.rotate(angle, expand=True, fillcolor='white')

def extract_text_from_image(image):
    """Extract text from image using EasyOCR"""
    try:
        # Convert PIL image to numpy array for EasyOCR
        img_array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        
        # Initialize EasyOCR reader (same as door_detector.py)
        reader = easyocr.Reader(['en'])
        
        # Use EasyOCR to extract text
        results = reader.readtext(img_array)
        
        # Extract text with confidence filtering
        extracted_texts = []
        for (bbox, text, confidence) in results:
            if confidence > 0.3:  # Lower threshold for better detection
                extracted_texts.append(text.strip())
        
        # Combine all detected text
        combined_text = ' '.join(extracted_texts)
        
        return combined_text if combined_text else "No text detected"
    except Exception as e:
        return f"OCR Error: {str(e)}"

def extract_decimal_number(text):
    """Extract decimal number from OCR text"""
    # Regex to find decimal numbers like 1.00, 0.99, 0.84, etc.
    pattern = r'\b\d+\.\d+\b'
    
    match = re.search(pattern, text)
    if match:
        return match.group(0)
    else:
        return "No decimal found"

def find_matches(alignment_data, force_all_el_matched=True):
    door_centers = np.array(alignment_data['door_centers'])
    el_aligned = np.array(alignment_data['el_centers_aligned'])
    
    if len(door_centers) == 0 or len(el_aligned) == 0:
        return []
    
    if force_all_el_matched:
        # Use Hungarian algorithm for optimal one-to-one matching
        from scipy.spatial.distance import cdist
        from scipy.optimize import linear_sum_assignment
        
        # Compute distance matrix
        distance_matrix = cdist(el_aligned, door_centers)
        
        # Find optimal one-to-one assignment
        el_indices, door_indices = linear_sum_assignment(distance_matrix)
        
        matches = []
        for el_idx, door_idx in zip(el_indices, door_indices):
            dist = distance_matrix[el_idx, door_idx]
            matches.append((int(el_idx), int(door_idx), float(dist)))
        
        return matches
    else:
        # Original threshold-based matching (can be many-to-one)
        tree = cKDTree(door_centers)
        distances, indices = tree.query(el_aligned, k=1)
        
        matches = []
        threshold = 100
        for el_idx, (dist, door_idx) in enumerate(zip(distances, indices)):
            if dist <= threshold:
                matches.append((el_idx, door_idx, dist))
        
        return matches

def load_alignment_data():
    with open('alignment_result.json', 'r') as f:
        alignment = json.load(f)
    with open('door_detections.json', 'r') as f:
        door_data = json.load(f)
    with open('el_detections.json', 'r') as f:
        el_data = json.load(f)
    return alignment, door_data, el_data

def load_pdf_images():
    pdf_path = "/Users/harshvardhanagarwal/Desktop/project.pdf"
    doc = fitz.open(pdf_path)
    
    door_page = doc[43]
    door_pix = door_page.get_pixmap(matrix=fitz.Matrix(2, 2))
    door_img = Image.frombytes("RGB", [door_pix.width, door_pix.height], door_pix.samples)
    
    el_page = doc[116]
    el_pix = el_page.get_pixmap(matrix=fitz.Matrix(2, 2))
    el_img = Image.frombytes("RGB", [el_pix.width, el_pix.height], el_pix.samples)
    
    doc.close()
    return door_img, el_img



def crop_bbox(img, bbox, padding=20, left_padding=None, right_padding=None, top_padding=None, bottom_padding=None):
    x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
    
    # Use custom padding for each side if provided, otherwise use default
    left_pad = left_padding if left_padding is not None else padding
    right_pad = right_padding if right_padding is not None else padding
    top_pad = top_padding if top_padding is not None else padding
    bottom_pad = bottom_padding if bottom_padding is not None else padding
    
    x1 = max(0, x - left_pad)
    y1 = max(0, y - top_pad)
    x2 = min(img.width, x + w + right_pad)
    y2 = min(img.height, y + h + bottom_pad)
    
    cropped = img.crop((x1, y1, x2, y2))
    return cropped

def create_side_by_side(door_crop, el_crop, door_text, el_text, match_info):
    # Extract degree and rotate door image
    door_degree = extract_door_degree(door_text)
    rotated_door_crop = rotate_image(door_crop, door_degree)
    
    # Extract text from rotated door image using OCR
    ocr_text = extract_text_from_image(rotated_door_crop)
    decimal_number = extract_decimal_number(ocr_text)
    
    # Extract inches from EL text
    inches_value = parse_elevation_text(el_text)
    
    door_w, door_h = rotated_door_crop.size
    el_w, el_h = el_crop.size
    
    max_h = max(door_h, el_h)
    total_w = door_w + el_w + 20
    
    combined = Image.new('RGB', (total_w, max_h + 60), color='white')
    
    door_y = (max_h - door_h) // 2
    el_y = (max_h - el_h) // 2
    
    combined.paste(rotated_door_crop, (0, door_y))
    combined.paste(el_crop, (door_w + 20, el_y))
    
    fig, ax = plt.subplots(1, 1, figsize=(total_w/100, (max_h + 60)/100))
    ax.imshow(combined)
    
    ax.text(door_w//2, max_h + 15, f"DOOR: {parse_door_text(door_text)}", 
            ha='center', va='center', fontsize=10, weight='bold', color='red')
    ax.text(door_w + 20 + el_w//2, max_h + 15, f"EL: {inches_value}", 
            ha='center', va='center', fontsize=10, weight='bold', color='green')
    ax.text(total_w//2, max_h + 40, f"Distance: {match_info['distance']:.1f}px", 
            ha='center', va='center', fontsize=9, color='blue')
    
    # Add decimal number below distance
    ax.text(total_w//2, max_h + 55, f"Value: {decimal_number}", 
            ha='center', va='center', fontsize=8, color='purple', style='italic')
    
    ax.set_xlim(0, total_w)
    ax.set_ylim(max_h + 75, 0)  # Increased to accommodate OCR text
    ax.axis('off')
    
    return fig, decimal_number, inches_value

def save_annotated_images(door_img, el_img, matches, door_data, el_data):
    door_img_annotated = door_img.copy()
    el_img_annotated = el_img.copy()
    
    # Convert PIL to cv2 for drawing
    door_cv = cv2.cvtColor(np.array(door_img_annotated), cv2.COLOR_RGB2BGR)
    el_cv = cv2.cvtColor(np.array(el_img_annotated), cv2.COLOR_RGB2BGR)
    
    # Get matched indices
    matched_door_indices = set(door_idx for _, door_idx, _ in matches)
    matched_el_indices = set(el_idx for el_idx, _, _ in matches)
    
    # Draw all DOOR detections
    for i, detection in enumerate(door_data['detections']):
        bbox = detection['bbox']
        x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
        
        if i in matched_door_indices:
            # Find group number for this matched detection
            group_num = next(j + 1 for j, (_, door_idx, _) in enumerate(matches) if door_idx == i)
            cv2.rectangle(door_cv, (x, y), (x + w, y + h), (0, 0, 255), 3)
            cv2.putText(door_cv, f"GROUP {group_num}", (x, y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        else:
            # Unmatched detection - lighter color, no text
            cv2.rectangle(door_cv, (x, y), (x + w, y + h), (128, 128, 255), 2)
    
    # Draw all EL detections
    for i, detection in enumerate(el_data['detections']):
        bbox = detection['bbox']
        x, y, w, h = bbox['x'], bbox['y'], bbox['width'], bbox['height']
        
        if i in matched_el_indices:
            # Find group number for this matched detection
            group_num = next(j + 1 for j, (el_idx, _, _) in enumerate(matches) if el_idx == i)
            cv2.rectangle(el_cv, (x, y), (x + w, y + h), (0, 255, 0), 3)
            cv2.putText(el_cv, f"GROUP {group_num}", (x, y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        else:
            # Unmatched detection - lighter color, no text
            cv2.rectangle(el_cv, (x, y), (x + w, y + h), (128, 255, 128), 2)
    
    # Convert back to PIL and save
    door_annotated_pil = Image.fromarray(cv2.cvtColor(door_cv, cv2.COLOR_BGR2RGB))
    el_annotated_pil = Image.fromarray(cv2.cvtColor(el_cv, cv2.COLOR_BGR2RGB))
    
    door_annotated_pil.save('matches/door_page_annotated.png')
    el_annotated_pil.save('matches/el_page_annotated.png')
    
    print("Saved annotated full page images:")
    print("  - matches/door_page_annotated.png")
    print("  - matches/el_page_annotated.png")
    print(f"  - Matched: {len(matches)} pairs")
    print(f"  - Unmatched DOOR: {len(door_data['detections']) - len(matched_door_indices)}")
    print(f"  - Unmatched EL: {len(el_data['detections']) - len(matched_el_indices)}")

def create_matches_tool(project_id: int, sheet_code: str = None):
    """
    Create matches using create_matches logic
    """
    try:
        from database import SessionLocal, Sheet, Document, Project
        from sqlalchemy import func
        
        db = SessionLocal()
        
        # Find the main project PDF path
        pdf_path = f"../documents/1755303713426-project.pdf"
        
        # Build query for sheets
        query = db.query(Sheet).join(Document).join(Project).filter(
            Project.id == project_id,
            Sheet.status == 'completed'
        )
        
        if sheet_code:
            query = query.filter(func.lower(Sheet.code) == sheet_code.lower())
        else:
            db.close()
            return {
                'success': False,
                'error': 'Please specify a sheet code'
            }
        
        sheets = query.all()
        
        if not sheets:
            db.close()
            return {
                'success': False,
                'error': f'Sheet "{sheet_code}" not found'
            }
        
        sheet = sheets[0]
        
        # EXACT create_matches.py logic
        alignment_data, door_data, el_data = load_alignment_data()
        door_img, el_img = load_pdf_images()
        
        matches = find_matches(alignment_data, force_all_el_matched=True)
        
        print(f"Found {len(matches)} matches within threshold")
        
        if len(matches) == 0:
            db.close()
            return {
                'success': False,
                'error': 'No matches found. Try increasing the threshold.'
            }
        
        os.makedirs('matches', exist_ok=True)
        
        # Initialize pairs collection
        decimal_inches_pairs = []
        
        for i, (el_idx, door_idx, distance) in enumerate(matches):
            door_detection = door_data['detections'][door_idx]
            el_detection = el_data['detections'][el_idx]
            
            door_bbox = door_detection['bbox']
            el_bbox = el_detection['bbox']
            
            door_crop = crop_bbox(door_img, door_bbox, 
                                left_padding=30, right_padding=30, top_padding=20, bottom_padding=5)
            el_crop = crop_bbox(el_img, el_bbox, padding=30)
            
            match_info = {
                'el_idx': el_idx,
                'door_idx': door_idx,
                'distance': distance,
                'door_text': door_detection['text'],
                'el_text': el_detection['text']
            }
            
            fig, decimal_number, inches_value = create_side_by_side(
                door_crop, el_crop,
                door_detection['text'], el_detection['text'],
                match_info
            )
            
            # Collect the pair
            decimal_inches_pairs.append({
                'match_id': i + 1,
                'door_id': door_detection.get('id', f'DOOR_{door_idx+1}'),
                'el_id': el_detection.get('id', f'EL_{el_idx+1}'),
                'decimal_value': decimal_number,
                'inches_value': inches_value,
                'distance': distance
            })
            
            filename = f"matches/match_{i+1:03d}_EL{el_idx+1}_DOOR{door_idx+1}.png"
            fig.savefig(filename, dpi=150, bbox_inches='tight', pad_inches=0.1)
            plt.close(fig)
            
            print(f"Saved {filename}: EL '{el_detection['text']}' <-> DOOR '{door_detection['text']}' (dist: {distance:.1f}px)")
        
        # Save pairs to JSON
        pairs_output = {
            'total_pairs': len(decimal_inches_pairs),
            'pairs': decimal_inches_pairs
        }
        
        with open('decimal_inches_pairs.json', 'w') as f:
            json.dump(pairs_output, f, indent=2)
        
        print(f"\nSaved {len(decimal_inches_pairs)} decimal-inches pairs to decimal_inches_pairs.json")
        
        # Save annotated full page images
        save_annotated_images(door_img, el_img, matches, door_data, el_data)
        
        matches_summary = {
            'total_matches': len(matches),
            'matches': [
                {
                    'match_id': i+1,
                    'el_detection': {
                        'index': int(el_idx),
                        'text': el_data['detections'][el_idx]['text'],
                        'bbox': el_data['detections'][el_idx]['bbox']
                    },
                    'door_detection': {
                        'index': int(door_idx),
                        'text': door_data['detections'][door_idx]['text'],
                        'bbox': door_data['detections'][door_idx]['bbox']
                    },
                    'distance': float(distance)
                }
                for i, (el_idx, door_idx, distance) in enumerate(matches)
            ]
        }
        
        with open('matches/matches_summary.json', 'w') as f:
            json.dump(matches_summary, f, indent=2)
        
        print(f"\nSummary saved to matches/matches_summary.json")
        
        db.close()
        
        return {
            'success': True,
            'total_matches': len(matches),
            'total_pairs': len(decimal_inches_pairs),
            'decimal_inches_pairs': decimal_inches_pairs,
            'matches_summary': matches_summary,
            'unmatched_door': len(door_data['detections']) - len(set(door_idx for _, door_idx, _ in matches)),
            'unmatched_el': len(el_data['detections']) - len(set(el_idx for el_idx, _, _ in matches))
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

def main():
    alignment_data, door_data, el_data = load_alignment_data()
    door_img, el_img = load_pdf_images()
    
    matches = find_matches(alignment_data, force_all_el_matched=True)
    
    print(f"Found {len(matches)} matches within threshold")
    
    if len(matches) == 0:
        print("No matches found. Try increasing the threshold.")
        return
    
    os.makedirs('matches', exist_ok=True)
    
    # Initialize pairs collection
    decimal_inches_pairs = []
    
    for i, (el_idx, door_idx, distance) in enumerate(matches):
        door_detection = door_data['detections'][door_idx]
        el_detection = el_data['detections'][el_idx]
        
        door_bbox = door_detection['bbox']
        el_bbox = el_detection['bbox']
        
        door_crop = crop_bbox(door_img, door_bbox, 
                            left_padding=30, right_padding=30, top_padding=20, bottom_padding=5)
        el_crop = crop_bbox(el_img, el_bbox, padding=30)
        
        match_info = {
            'el_idx': el_idx,
            'door_idx': door_idx,
            'distance': distance,
            'door_text': door_detection['text'],
            'el_text': el_detection['text']
        }
        
        fig, decimal_number, inches_value = create_side_by_side(
            door_crop, el_crop,
            door_detection['text'], el_detection['text'],
            match_info
        )
        
        # Collect the pair
        decimal_inches_pairs.append({
            'match_id': i + 1,
            'door_id': door_detection.get('id', f'DOOR_{door_idx+1}'),
            'el_id': el_detection.get('id', f'EL_{el_idx+1}'),
            'decimal_value': decimal_number,
            'inches_value': inches_value,
            'distance': distance
        })
        
        filename = f"matches/match_{i+1:03d}_EL{el_idx+1}_DOOR{door_idx+1}.png"
        fig.savefig(filename, dpi=150, bbox_inches='tight', pad_inches=0.1)
        plt.close(fig)
        
        print(f"Saved {filename}: EL '{el_detection['text']}' <-> DOOR '{door_detection['text']}' (dist: {distance:.1f}px)")
    
    # Save pairs to JSON
    pairs_output = {
        'total_pairs': len(decimal_inches_pairs),
        'pairs': decimal_inches_pairs
    }
    
    with open('decimal_inches_pairs.json', 'w') as f:
        json.dump(pairs_output, f, indent=2)
    
    print(f"\nSaved {len(decimal_inches_pairs)} decimal-inches pairs to decimal_inches_pairs.json")
    
    # Save annotated full page images
    save_annotated_images(door_img, el_img, matches, door_data, el_data)
    
    matches_summary = {
        'total_matches': len(matches),
        'matches': [
            {
                'match_id': i+1,
                'el_detection': {
                    'index': int(el_idx),
                    'text': el_data['detections'][el_idx]['text'],
                    'bbox': el_data['detections'][el_idx]['bbox']
                },
                'door_detection': {
                    'index': int(door_idx),
                    'text': door_data['detections'][door_idx]['text'],
                    'bbox': door_data['detections'][door_idx]['bbox']
                },
                'distance': float(distance)
            }
            for i, (el_idx, door_idx, distance) in enumerate(matches)
        ]
    }
    
    with open('matches/matches_summary.json', 'w') as f:
        json.dump(matches_summary, f, indent=2)
    
    print(f"\nSummary saved to matches/matches_summary.json")

if __name__ == "__main__":
    main()