import fitz
from PIL import Image, ImageDraw, ImageFont
import base64
import io
import json
import numpy as np

def is_potential_arrow(drawing):
    """Determine if a drawing could be an arrow head"""
    rect = drawing.get('rect')
    if not rect:
        return False
    
    # Check size - arrow heads are typically small
    width = rect.x1 - rect.x0
    height = rect.y1 - rect.y0
    area = width * height
    
    if area < 5 or area > 500:  # Adjust thresholds as needed
        return False
    
    # Check aspect ratio
    if width > 0 and height > 0:
        aspect_ratio = max(width, height) / min(width, height)
        if aspect_ratio > 5:  # Too elongated
            return False
    
    # Check if it's a filled AND stroked shape (arrows are specifically 'fs' type)
    drawing_type = drawing.get('type', '')
    if drawing_type != 'fs':
        return False
    
    # Check drawing items - arrows should have line segments, not curves
    items = drawing.get('items', [])
    if len(items) < 2:  # Need multiple items for arrow shape
        return False
    
    # Count line segments and check for curves
    line_count = 0
    has_curves = False
    
    for item in items:
        if isinstance(item, dict):
            item_type = item.get('type', '')
            if item_type == 'l':  # Line segment
                line_count += 1
            elif item_type in ['c', 'v', 'y']:  # Curve types (cubic bezier, etc)
                has_curves = True
        elif isinstance(item, tuple) and len(item) > 0:
            item_type = item[0]
            if item_type == 'l':  # Line segment
                line_count += 1
            elif item_type in ['c', 'v', 'y']:  # Curve types
                has_curves = True
    
    # Arrows should have line segments, not curves (ovals have curves)
    if has_curves:
        return False
    
    # Need at least 2 line segments for arrow head
    if line_count >= 2:
        return True
    
    return False

def detect_arrows(page):
    """Detect arrow heads on the page using the same logic as arrow_detector.py"""
    drawings = page.get_drawings()
    arrows = []
    
    for i, drawing in enumerate(drawings):
        if is_potential_arrow(drawing):
            rect = drawing.get('rect')
            if rect:
                arrows.append({
                    'id': f'ARROW_{len(arrows)+1}',
                    'center': ((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2),
                    'bbox': {
                        'x': rect.x0,
                        'y': rect.y0,
                        'width': rect.x1 - rect.x0,
                        'height': rect.y1 - rect.y0
                    },
                    'drawing_id': i,
                    'rect': rect
                })
    
    return arrows

def find_nearby_arrows(el_center, arrows, max_distance=50):
    """Find arrows within max_distance of an EL text center"""
    nearby_arrows = []
    el_x, el_y = el_center
    
    for arrow in arrows:
        arrow_x, arrow_y = arrow['center']
        distance = np.sqrt((el_x - arrow_x)**2 + (el_y - arrow_y)**2)
        
        if distance <= max_distance:
            nearby_arrows.append({
                'arrow_id': arrow['id'],
                'distance': float(distance),
                'arrow_center': arrow['center'],
                'arrow_bbox': arrow['bbox'],
                'arrow': arrow  # Keep full arrow data for assignment
            })
    
    return nearby_arrows

def assign_arrows_to_closest_el(el_boxes, arrows, max_distance=50):
    """Two-phase arrow assignment: filter then assign to closest EL"""
    
    # Phase 1: Collect all arrows within threshold of ANY EL
    candidate_arrows = set()
    el_centers = []
    
    for i, (x, y, w, h, text, _) in enumerate(el_boxes):
        # Calculate center of EL text (in original coordinates)
        el_center_x = (x/2 + (x+w)/2) / 2  # Convert back from 2x scale
        el_center_y = (y/2 + (y+h)/2) / 2
        el_centers.append((el_center_x, el_center_y, i))
        
        # Find arrows within threshold
        nearby = find_nearby_arrows((el_center_x, el_center_y), arrows, max_distance)
        for arrow_data in nearby:
            candidate_arrows.add(arrow_data['arrow']['id'])
    
    # Phase 2: Assign each candidate arrow to its closest EL
    arrow_assignments = {}  # arrow_id -> (el_index, distance)
    
    for arrow in arrows:
        if arrow['id'] in candidate_arrows:
            closest_el = None
            min_distance = float('inf')
            
            for el_center_x, el_center_y, el_idx in el_centers:
                arrow_x, arrow_y = arrow['center']
                distance = np.sqrt((el_center_x - arrow_x)**2 + (el_center_y - arrow_y)**2)
                
                if distance < min_distance:
                    min_distance = distance
                    closest_el = el_idx
            
            if closest_el is not None:
                arrow_assignments[arrow['id']] = (closest_el, min_distance, arrow)
    
    # Convert assignments back to el_boxes format
    el_arrow_assignments = [[] for _ in range(len(el_boxes))]
    
    for arrow_id, (el_idx, distance, arrow) in arrow_assignments.items():
        el_arrow_assignments[el_idx].append({
            'arrow_id': arrow_id,
            'distance': float(distance),
            'arrow_center': arrow['center'],
            'arrow_bbox': arrow['bbox']
        })
    
    return el_arrow_assignments

def show_el_vectors(project_id: int, sheet_code: str = None):
    """
    Extract EL vectors using el_vector_detector logic
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
        
        # EXACT el_vector_detector.py logic
        doc = fitz.open(pdf_path)
        page = doc[sheet.page - 1]
        
        # Detect arrows first
        arrows = detect_arrows(page)
        
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        
        # Create highlighted image with prefix overlay
        highlighted_img = img.copy()
        draw = ImageDraw.Draw(highlighted_img)
        
        try:
            # Try to use a reasonably sized font
            font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 16)
            small_font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 12)
        except:
            # Fallback to default font
            font = ImageFont.load_default()
            small_font = ImageFont.load_default()
        
        text_instances = page.get_text("dict")
        
        el_boxes = []
        for block in text_instances["blocks"]:
            if "lines" in block:
                for line in block["lines"]:
                    for span in line["spans"]:
                        text = span["text"].strip()
                        if text.upper().startswith("EL."):
                            bbox = span["bbox"]
                            x = int(bbox[0] * 2)
                            y = int(bbox[1] * 2)
                            w = int((bbox[2] - bbox[0]) * 2)
                            h = int((bbox[3] - bbox[1]) * 2)
                            
                            # Store without nearby_arrows for now
                            el_boxes.append((x, y, w, h, text, []))
        
        # Perform two-phase arrow assignment
        el_arrow_assignments = assign_arrows_to_closest_el(el_boxes, arrows, max_distance=150)
        
        # Update el_boxes with assignments
        for i in range(len(el_boxes)):
            x, y, w, h, text, _ = el_boxes[i]
            el_boxes[i] = (x, y, w, h, text, el_arrow_assignments[i])
        
        # Add prefix highlighting to the image
        # FIRST highlight EL texts
        for i, (x, y, w, h, text, nearby_arrows) in enumerate(el_boxes):
            el_id = f"EL_{i+1}"
            
            # Draw EL text bounding box
            draw.rectangle([x, y, x + w, y + h], outline="green", width=3)
            
            # Add EL prefix label above the box
            text_x = x
            text_y = max(0, y - 25)
            
            # Draw text background for better visibility
            text_bbox = draw.textbbox((text_x, text_y), el_id, font=font)
            draw.rectangle(text_bbox, fill="yellow", outline="green")
            
            # Draw the EL prefix text
            draw.text((text_x, text_y), el_id, fill="green", font=font)
        
        # THEN highlight ONLY nearby arrows with EL labels
        for i, (x, y, w, h, text, nearby_arrows) in enumerate(el_boxes):
            el_id = f"EL_{i+1}"
            
            # Draw only the nearby arrows for this EL
            for arrow in nearby_arrows:
                arrow_x = int(arrow['arrow_bbox']['x'] * 2)
                arrow_y = int(arrow['arrow_bbox']['y'] * 2)
                arrow_w = int(arrow['arrow_bbox']['width'] * 2)
                arrow_h = int(arrow['arrow_bbox']['height'] * 2)
                
                # Draw arrow bounding box
                draw.rectangle([arrow_x, arrow_y, arrow_x + arrow_w, arrow_y + arrow_h], outline="red", width=2)
                
                # Add EL label above the arrow (not ARROW_X)
                text_x = arrow_x
                text_y = max(0, arrow_y - 20)
                
                # Draw text background for better visibility
                text_bbox = draw.textbbox((text_x, text_y), el_id, font=small_font)
                draw.rectangle(text_bbox, fill="yellow", outline="red")
                
                # Draw the EL label on the arrow
                draw.text((text_x, text_y), el_id, fill="red", font=small_font)
        
        # Save the highlighted image
        highlighted_img.save('el_detection_highlighted.png')
        
        # Convert highlighted image to base64 for SVG
        buf = io.BytesIO()
        highlighted_img.save(buf, format='PNG')
        img_data = base64.b64encode(buf.getvalue()).decode()
        
        svg_content = f'<svg width="{pix.width}" height="{pix.height}" xmlns="http://www.w3.org/2000/svg">\n'
        svg_content += f'<image href="data:image/png;base64,{img_data}" width="{pix.width}" height="{pix.height}"/>\n'
        svg_content += '</svg>'
        
        svg_content += '</svg>'
        
        with open('el_detection.svg', 'w') as f:
            f.write(svg_content)
        
        # Output JSON with bounding boxes and nearby arrows
        el_json = {
            "page": sheet.page,
            "total_arrows_detected": len(arrows),
            "detections": []
        }
        
        for i, (x, y, w, h, text, nearby_arrows) in enumerate(el_boxes):
            el_base_id = f"EL_{i+1}"
            
            if len(nearby_arrows) == 0:
                # No nearby arrows - create single EL entry
                el_json["detections"].append({
                    "id": el_base_id,
                    "text": text,
                    "bbox": {
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h
                    },
                    "nearby_arrows": [],
                    "nearby_arrows_count": 0
                })
            else:
                # Multiple arrows - create separate EL entry for each arrow with offset
                for arrow_idx, arrow in enumerate(nearby_arrows):
                    # Create slight position offset for each arrow
                    offset_x = arrow_idx * 2  # Small horizontal offset
                    offset_y = arrow_idx * 1  # Small vertical offset
                    
                    # Generate unique ID for each EL-arrow pair
                    if len(nearby_arrows) == 1:
                        unique_id = el_base_id  # Keep original ID if only one arrow
                    else:
                        suffix = chr(ord('a') + arrow_idx)  # a, b, c, d, ...
                        unique_id = f"{el_base_id}{suffix}"
                    
                    el_json["detections"].append({
                        "id": unique_id,
                        "text": text,
                        "bbox": {
                            "x": x + offset_x,
                            "y": y + offset_y,
                            "width": w,
                            "height": h
                        },
                        "nearby_arrows": [arrow],  # Only this specific arrow
                        "nearby_arrows_count": 1,
                        "original_el_id": el_base_id,
                        "arrow_index": arrow_idx
                    })
        
        with open('el_detections.json', 'w') as f:
            json.dump(el_json, f, indent=2)
        
        doc.close()
        db.close()
        
        return {
            'success': True,
            'total_el_vectors': len(el_json["detections"]),
            'total_arrows_detected': len(arrows),
            'all_el_vectors': el_json["detections"]
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }