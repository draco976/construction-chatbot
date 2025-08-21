import fitz
import easyocr
from PIL import Image
import base64
import io
import cv2
import numpy as np
import json

def calculate_iou(box1, box2):
    """Calculate IoU between two bounding boxes (x, y, w, h)"""
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2
    
    # Calculate intersection
    x_left = max(x1, x2)
    y_top = max(y1, y2)
    x_right = min(x1 + w1, x2 + w2)
    y_bottom = min(y1 + h1, y2 + h2)
    
    if x_right < x_left or y_bottom < y_top:
        return 0.0
    
    intersection = (x_right - x_left) * (y_bottom - y_top)
    area1 = w1 * h1
    area2 = w2 * h2
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0

def filter_overlapping_boxes(door_boxes, iou_threshold=0.5):
    """Remove boxes with high IoU overlap, keeping the one with higher confidence"""
    if len(door_boxes) <= 1:
        return door_boxes
    
    # Sort by confidence (extract from text field)
    boxes_with_conf = []
    for box in door_boxes:
        x, y, w, h, text = box
        # Extract confidence from text like "DOOR (P3 -45° 0.87)"
        try:
            conf = float(text.split()[-1].rstrip(')'))
        except:
            conf = 0.5  # default confidence
        boxes_with_conf.append((x, y, w, h, text, conf))
    
    # Sort by confidence (highest first)
    boxes_with_conf.sort(key=lambda x: x[5], reverse=True)
    
    filtered_boxes = []
    for i, (x1, y1, w1, h1, text1, conf1) in enumerate(boxes_with_conf):
        keep = True
        for x2, y2, w2, h2, text2 in filtered_boxes:
            iou = calculate_iou((x1, y1, w1, h1), (x2, y2, w2, h2))
            if iou > iou_threshold:
                keep = False
                break
        
        if keep:
            filtered_boxes.append((x1, y1, w1, h1, text1))
    
    print(f"Filtered {len(door_boxes) - len(filtered_boxes)} overlapping boxes (IoU > {iou_threshold})")
    return filtered_boxes

def rotate_with_inverse(img, angle):
    h, w = img.shape[:2]
    center = ((w - 1) / 2.0, (h - 1) / 2.0)
    M = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    Minv = cv2.invertAffineTransform(M)
    return rotated, Minv

def apply_affine(points, A2x3):
    pts = np.asarray(points, dtype=np.float32)
    ones = np.ones((pts.shape[0], 1), dtype=np.float32)
    pts_h = np.hstack([pts, ones])
    mapped = (A2x3 @ pts_h.T).T
    return mapped

def create_patches(img, overlap_ratio=0.2):
    h, w = img.shape[:2]
    patches = []
    
    # 4x4 grid for 16 patches
    rows, cols = 4, 4
    patch_h = h // rows
    patch_w = w // cols
    
    overlap_h = int(patch_h * overlap_ratio)
    overlap_w = int(patch_w * overlap_ratio)
    
    for r in range(rows):
        for c in range(cols):
            y1 = max(0, r * patch_h - overlap_h)
            y2 = min(h, (r + 1) * patch_h + overlap_h)
            x1 = max(0, c * patch_w - overlap_w)
            x2 = min(w, (c + 1) * patch_w + overlap_w)
            
            patch = img[y1:y2, x1:x2]
            patches.append((patch, x1, y1))
    
    return patches

def show_exterior_elevations(project_id: int, sheet_code: str = None):
    """
    Extract elevations using door_detector logic
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
        
        # EXACT door_detector.py logic
        doc = fitz.open(pdf_path)
        page = doc[sheet.page - 1]
        
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img_cv = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        
        reader = easyocr.Reader(['en'])
        
        door_boxes = []
        angles = [0, -45, 45]
        patches = create_patches(img_cv)
        
        for patch_idx, (patch, offset_x, offset_y) in enumerate(patches):
            print(f"Processing patch {patch_idx + 1}/16")
            
            for angle in angles:
                if angle == 0:
                    test_patch = patch
                    results = reader.readtext(test_patch)
                    
                    for (bbox, text, confidence) in results:
                        if 'DOOR' in text.upper() and confidence > 0.5:
                            x_coords = [point[0] for point in bbox]
                            y_coords = [point[1] for point in bbox]
                            patch_x = int(min(x_coords))
                            patch_y = int(min(y_coords))
                            patch_w = int(max(x_coords) - min(x_coords))
                            patch_h = int(max(y_coords) - min(y_coords))
                            
                            final_x = patch_x + offset_x
                            final_y = patch_y + offset_y
                            
                            door_boxes.append((final_x, final_y, patch_w, patch_h, f"{text} (P{patch_idx+1} {angle}° {confidence:.2f})"))
                else:
                    test_patch, Minv = rotate_with_inverse(patch, angle)
                    results = reader.readtext(test_patch)
                    
                    for (bbox, text, confidence) in results:
                        if 'DOOR' in text.upper() and confidence > 0.5:
                            orig_pts = apply_affine(bbox, Minv)
                            
                            x_coords = orig_pts[:, 0]
                            y_coords = orig_pts[:, 1]
                            x_min = float(np.min(x_coords))
                            y_min = float(np.min(y_coords))
                            x_max = float(np.max(x_coords))
                            y_max = float(np.max(y_coords))
                            
                            H, W = patch.shape[:2]
                            x_min = max(0.0, min(x_min, W - 1.0))
                            y_min = max(0.0, min(y_min, H - 1.0))
                            x_max = max(0.0, min(x_max, W - 1.0))
                            y_max = max(0.0, min(y_max, H - 1.0))
                            
                            patch_x = int(np.floor(x_min))
                            patch_y = int(np.floor(y_min))
                            rect_w = int(np.ceil(x_max - x_min))
                            rect_h = int(np.ceil(y_max - y_min))
                            
                            final_x = patch_x + offset_x
                            final_y = patch_y + offset_y
                            
                            door_boxes.append((final_x, final_y, rect_w, rect_h, f"{text} (P{patch_idx+1} {angle}° {confidence:.2f})"))
        
        # Filter overlapping detections from different patches
        print(f"\nFound {len(door_boxes)} total detections before filtering")
        door_boxes = filter_overlapping_boxes(door_boxes, iou_threshold=0.5)
        print(f"Kept {len(door_boxes)} detections after IoU filtering")
        
        # Debug: draw rectangles on original image
        dbg = img_cv.copy()
        for x, y, w, h, _ in door_boxes:
            cv2.rectangle(dbg, (x, y), (x+w, y+h), (0, 0, 255), 2)
        cv2.imwrite('door_debug.png', dbg)
        
        # Output JSON with bounding boxes
        door_json = {
            "page": sheet.page,
            "detections": []
        }
        
        for i, (x, y, w, h, text) in enumerate(door_boxes):
            door_json["detections"].append({
                "id": f"DOOR_{i+1}",
                "text": text,
                "bbox": {
                    "x": x,
                    "y": y,
                    "width": w,
                    "height": h
                }
            })
        
        with open('door_detections.json', 'w') as f:
            json.dump(door_json, f, indent=2)
        
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        img_data = base64.b64encode(buf.getvalue()).decode()
        
        svg_content = f'<svg width="{pix.width}" height="{pix.height}" xmlns="http://www.w3.org/2000/svg">\n'
        svg_content += f'<image href="data:image/png;base64,{img_data}" width="{pix.width}" height="{pix.height}"/>\n'
        
        for i, (x, y, w, h, text) in enumerate(door_boxes):
            svg_content += f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="red" stroke-width="3"/>\n'
            svg_content += f'<text x="{x}" y="{y-5}" fill="red" font-size="12">DOOR_{i+1}: {text}</text>\n'
        
        svg_content += '</svg>'
        
        with open('door_detection.svg', 'w') as f:
            f.write(svg_content)
        
        # JSON output
        json_output = [{"x": x, "y": y, "width": w, "height": h, "text": text} for x, y, w, h, text in door_boxes]
        with open('door_detection.json', 'w') as json_file:
            json.dump(json_output, json_file)
        
        doc.close()
        db.close()
        
        return {
            'success': True,
            'total_elevations': len(door_boxes),
            'all_elevations': [{"x": x, "y": y, "width": w, "height": h, "text": t} for x, y, w, h, t in door_boxes]
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }