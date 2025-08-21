import json
import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.distance import cdist
import matplotlib.pyplot as plt
from scipy.optimize import linear_sum_assignment

def load_detections(door_file, el_file):
    with open(door_file, 'r') as f:
        door_data = json.load(f)
    with open(el_file, 'r') as f:
        el_data = json.load(f)
    return door_data, el_data

def extract_centers(detections):
    centers = []
    for det in detections['detections']:
        bbox = det['bbox']
        cx = bbox['x'] + bbox['width'] / 2
        cy = bbox['y'] + bbox['height'] / 2
        centers.append([cx, cy])
    return np.array(centers)

def _apply_affine_no_rot(points, sx, sy, tx, ty):
    pts = np.asarray(points, dtype=np.float64)
    S = np.array([sx, sy], dtype=np.float64)
    return pts * S + np.array([tx, ty], dtype=np.float64)

def _least_squares_scale_translation(A, B, anisotropic=False):
    A = np.asarray(A, dtype=np.float64)
    B = np.asarray(B, dtype=np.float64)
    muA = A.mean(axis=0); muB = B.mean(axis=0)
    Ac = A - muA; Bc = B - muB

    eps = 1e-12
    if anisotropic:
        denom_x = np.sum(Ac[:, 0]**2) + eps
        denom_y = np.sum(Ac[:, 1]**2) + eps
        sx = np.sum(Ac[:, 0] * Bc[:, 0]) / denom_x
        sy = np.sum(Ac[:, 1] * Bc[:, 1]) / denom_y
        sx = max(sx, eps); sy = max(sy, eps)
        tx, ty = (muB - np.array([sx, sy]) * muA)
        return sx, sy, tx, ty
    else:
        denom = np.sum(Ac * Ac) + eps
        s = np.sum(Ac * Bc) / denom
        s = max(s, eps)
        t = muB - s * muA
        return s, s, t[0], t[1]

def cdist_1NN(X, Y):
    if len(Y) == 0 or len(X) == 0:
        return np.array([], dtype=np.float64)
    try:
        tree = cKDTree(Y)
        d, _ = tree.query(X, k=1)
        return d
    except Exception:
        return np.min(cdist(X, Y), axis=1)

def align_detections(door_centers, el_centers, anisotropic=False, trim_frac=0.75,
                     max_iter=10, bidir_cost=True):
    A = np.asarray(el_centers, dtype=np.float64)    # EL to be aligned
    B = np.asarray(door_centers, dtype=np.float64)  # DOOR as reference
    if len(A) == 0 or len(B) == 0:
        return None, None

    muA, muB = A.mean(0), B.mean(0)
    Ac, Bc = A - muA, B - muB
    
    def _trim_by_radius(X, keep=0.8):
        if len(X) < 3: return X
        r = np.linalg.norm(X - X.mean(0), axis=1)
        k = max(2, int(keep * len(X)))
        return X[np.argsort(r)[:k]]
    
    Ac0 = _trim_by_radius(Ac, keep=0.8)
    Bc0 = _trim_by_radius(Bc, keep=0.8)

    if anisotropic:
        sx0 = np.sqrt((np.mean(Bc0[:,0]**2) + 1e-12) / (np.mean(Ac0[:,0]**2) + 1e-12))
        sy0 = np.sqrt((np.mean(Bc0[:,1]**2) + 1e-12) / (np.mean(Ac0[:,1]**2) + 1e-12))
    else:
        s0 = np.sqrt((np.mean(np.sum(Bc0**2, axis=1)) + 1e-12) /
                     (np.mean(np.sum(Ac0**2, axis=1)) + 1e-12))
        sx0 = sy0 = s0

    tx0, ty0 = (muB - np.array([sx0, sy0]) * muA)
    sx, sy, tx, ty = float(sx0), float(sy0), float(tx0), float(ty0)

    treeB = cKDTree(B)
    k_keep = max(2, int(trim_frac * min(len(A), len(B))))

    prev_err = np.inf
    for _ in range(max_iter):
        A_xf = _apply_affine_no_rot(A, sx, sy, tx, ty)
        dists_AB, idxB = treeB.query(A_xf, k=1)

        keep = np.argsort(dists_AB)[:k_keep]
        A_sel = A[keep]
        B_sel = B[idxB[keep]]

        sx, sy, tx, ty = _least_squares_scale_translation(A_sel, B_sel, anisotropic=anisotropic)

        A_xf = _apply_affine_no_rot(A, sx, sy, tx, ty)
        dAB = np.sort(cdist_1NN(A_xf, B))[:k_keep].mean()

        if bidir_cost:
            dBA = np.sort(cdist_1NN(B, A_xf))[:k_keep].mean()
            err = 0.5 * (dAB + dBA)
        else:
            err = dAB

        if abs(prev_err - err) < 1e-6:
            break
        prev_err = err

    scale = float((sx + sy) * 0.5) if not anisotropic else None
    params = np.array([scale if scale is not None else sx, 0.0, float(tx), float(ty)], dtype=np.float64)
    return params, float(prev_err)

def visualize_alignment(door_centers, el_centers, aligned_el_centers=None):
    plt.figure(figsize=(12, 8))
    
    if len(door_centers) > 0:
        plt.scatter(door_centers[:, 0], door_centers[:, 1], c='red', s=50, alpha=0.7, label='DOOR (reference)')
    
    if len(el_centers) > 0:
        plt.scatter(el_centers[:, 0], el_centers[:, 1], c='green', s=50, alpha=0.7, label='EL (original)')
    
    if aligned_el_centers is not None and len(aligned_el_centers) > 0:
        plt.scatter(aligned_el_centers[:, 0], aligned_el_centers[:, 1], c='blue', s=50, alpha=0.7, label='EL (aligned)')
    
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.axis('equal')
    plt.title('Detection Alignment - EL aligned to DOOR')
    plt.xlabel('X coordinate')
    plt.ylabel('Y coordinate')
    plt.savefig('alignment_visualization.png', dpi=150, bbox_inches='tight')
    plt.close()

def assign_many_to_one(aligned_el, door_centers, max_dist=np.inf):
    tree = cKDTree(door_centers)
    dists, idx = tree.query(aligned_el, k=1)
    idx[dists > max_dist] = -1
    return idx, dists


def main():
    door_data, el_data = load_detections('door_detections.json', 'el_detections.json')
    
    door_centers = extract_centers(door_data)
    el_centers = extract_centers(el_data)

    print(f"Found {len(door_centers)} DOOR centers and {len(el_centers)} EL centers")
    
    if len(door_centers) == 0:
        print("No DOOR detections found")
        return
    if len(el_centers) == 0:
        print("No EL detections found")
        return
    
    print("Door centers:")
    for i, center in enumerate(door_centers):
        print(f"  DOOR_{i+1}: ({center[0]:.1f}, {center[1]:.1f})")
    
    print("EL centers:")
    for i, center in enumerate(el_centers):
        print(f"  EL_{i+1}: ({center[0]:.1f}, {center[1]:.1f})")
    
    # Use iterative alignment instead of single-shot
    params, matches, history = iterative_align_and_assign(el_centers, door_centers, 
                                                         max_iter=10, anisotropic=False, verbose=True)
    
    if params is not None and matches is not None:
        scale, rotation, tx, ty = params
        print(f"\nFinal alignment parameters:")
        print(f"  Scale: {scale:.3f}")
        print(f"  Rotation: {rotation:.3f} rad ({np.degrees(rotation):.1f}°)")
        print(f"  Translation: ({tx:.1f}, {ty:.1f})")
        print(f"  Iterations: {len(history)}")
        
        aligned_el_centers = apply_transform_params(el_centers, scale, tx, ty)
        
        # Extract explicit matches from final iteration
        explicit_matches = []
        final_cost = 0.0
        for el_idx, door_idx, dist in matches:
            if door_idx != -1:  # valid match
                explicit_matches.append((el_idx, door_idx, dist))
                final_cost += dist
        
        avg_cost = final_cost / len(explicit_matches) if explicit_matches else 0.0
        
        print(f"  Final matches: {len(explicit_matches)}")
        print(f"  Final cost: {avg_cost:.2f}")
        print(f"  Unmatched EL: {len(el_centers) - len(explicit_matches)}")
        
        alignment_result = {
            "transformation": {
                "scale": float(scale),
                "rotation_rad": float(rotation),
                "rotation_deg": float(np.degrees(rotation)),
                "translation_x": float(tx),
                "translation_y": float(ty)
            },
            "cost": float(avg_cost),
            "iterations": len(history),
            "iteration_history": history,  # Already converted to lists in iteration_info
            "el_centers_original": el_centers.tolist(),
            "el_centers_aligned": aligned_el_centers.tolist(),
            "door_centers": door_centers.tolist(),
            "explicit_matches": [
                {
                    "el_idx": int(el_idx),
                    "door_idx": int(door_idx),
                    "distance": float(dist)
                }
                for el_idx, door_idx, dist in explicit_matches
            ]
        }
        
        with open('alignment_result.json', 'w') as f:
            json.dump(alignment_result, f, indent=2)
        
        visualize_alignment(door_centers, el_centers, aligned_el_centers)
        print("\nIterative alignment complete. Results saved to 'alignment_result.json' and 'alignment_visualization.png'")
        print(f"Explicit matches saved in 'explicit_matches' field of JSON")
    else:
        print("Alignment failed")
        visualize_alignment(door_centers, el_centers)

def apply_transform_params(points, scale, tx, ty):
    """Apply scale + translation transform to points"""
    return points * scale + np.array([tx, ty])

def compute_residuals(el_centers, door_centers, matches):
    """Compute residuals for current matches"""
    residuals = []
    for el_idx, door_idx, _ in matches:
        if door_idx != -1:
            residual = np.linalg.norm(el_centers[el_idx] - door_centers[door_idx])
            residuals.append(residual)
    return np.array(residuals)

def adaptive_gating_radius(residuals, factor=3.0):
    """Compute adaptive gating radius from residuals"""
    if len(residuals) == 0:
        return np.inf
    mad = np.median(np.abs(residuals - np.median(residuals)))
    if mad > 0:
        return factor * mad
    else:
        # Fallback when MAD=0 (identical residuals)
        return np.percentile(residuals, 90) if residuals.size > 0 else np.inf

def assign_with_gating(aligned_el, door_centers, max_radius=np.inf, method='many_to_one'):
    """Assign EL to DOOR with gating radius"""
    if method == 'many_to_one':
        tree = cKDTree(door_centers)
        dists, indices = tree.query(aligned_el, k=1)
        
        matches = []
        for el_idx, (dist, door_idx) in enumerate(zip(dists, indices)):
            if dist <= max_radius:
                matches.append((el_idx, door_idx, dist))
            else:
                matches.append((el_idx, -1, dist))  # Unmatched
        return matches
    
    elif method == 'hungarian':
        n_el, n_door = len(aligned_el), len(door_centers)
        
        # Create cost matrix with gating
        C = cdist(aligned_el, door_centers)
        C[C > max_radius] = 1e9  # Large penalty for gated distances
        
        # Set unmatch penalty strictly larger than any allowed real match
        if np.isfinite(max_radius) and max_radius > 0:
            # Use 1.5x the max allowed real match cost
            lambda_unmatch = 1.5 * max_radius
        else:
            # Fallback for infinite/zero radius cases - use robust scale
            valid_costs = C[C < 1e8]  # Exclude the gated penalties
            if len(valid_costs) > 0:
                # Use 90th percentile instead of max to avoid outlier domination
                lambda_unmatch = 1.25 * np.percentile(valid_costs, 90)
            else:
                lambda_unmatch = 1e6
        
        # Add dummy columns for unmatched ELs (conservative: allow all to be unmatched)
        n_dummies = max(1, n_el - n_door, n_el)  # At least n_el dummies
        dummy_cols = np.full((n_el, n_dummies), lambda_unmatch)
        C_with_dummies = np.hstack([C, dummy_cols])
        
        # No need for row padding with dummy columns
        C_sq = C_with_dummies
        
        row_ind, col_ind = linear_sum_assignment(C_sq)
        
        matches = []
        for r, c in zip(row_ind, col_ind):
            if r < n_el:  # Valid EL index
                if c < n_door:  # Matched to real DOOR
                    matches.append((r, c, C_sq[r, c]))
                else:  # Matched to dummy (unmatched)
                    matches.append((r, -1, np.inf))
        
        return matches

def robust_refit_from_matches(el_centers, door_centers, matches, trim_fraction=0.8, anisotropic=False):
    """Refit transformation parameters from matched pairs with robustness"""
    # Extract valid matched pairs
    valid_pairs = [(el_idx, door_idx) for el_idx, door_idx, dist in matches if door_idx != -1]
    
    if len(valid_pairs) < 2:
        return None  # Not enough matches
    
    A = np.array([el_centers[el_idx] for el_idx, _ in valid_pairs])
    B = np.array([door_centers[door_idx] for _, door_idx in valid_pairs])
    
    # Compute residuals for trimming
    if len(valid_pairs) > 3:  # Only trim if we have enough points
        # Quick fit to get residuals
        sx_temp, sy_temp, tx_temp, ty_temp = _least_squares_scale_translation(A, B, anisotropic)
        A_transformed = A * np.array([sx_temp, sy_temp]) + np.array([tx_temp, ty_temp])
        residuals = np.linalg.norm(A_transformed - B, axis=1)
        
        # Keep best fraction
        keep_count = max(2, int(trim_fraction * len(valid_pairs)))
        keep_indices = np.argsort(residuals)[:keep_count]
        A = A[keep_indices]
        B = B[keep_indices]
    
    # Final fit on trimmed data
    return _least_squares_scale_translation(A, B, anisotropic)

def damped_update(old_params, new_params, alpha=0.6):
    """Apply damped update to parameters"""
    if new_params is None:
        return old_params
    
    scale_old, _, tx_old, ty_old = old_params
    scale_new, _, tx_new, ty_new = new_params
    
    # Apply damping
    scale = (1 - alpha) * scale_old + alpha * scale_new
    tx = (1 - alpha) * tx_old + alpha * tx_new
    ty = (1 - alpha) * ty_old + alpha * ty_new
    
    # Apply scale bounds
    scale = np.clip(scale, 0.5, 2.0)
    
    return np.array([scale, 0.0, tx, ty])

def check_convergence(old_matches, new_matches, old_params, new_params, old_cost=None, new_cost=None,
                     assignment_tol=0.02, param_tol=1e-4, cost_tol=1e-5):
    """Check multiple convergence criteria"""
    # Assignment stability
    if old_matches is not None:
        old_assignments = {el_idx: door_idx for el_idx, door_idx, _ in old_matches}
        new_assignments = {el_idx: door_idx for el_idx, door_idx, _ in new_matches}
        
        changed = sum(1 for el_idx in old_assignments 
                     if old_assignments.get(el_idx) != new_assignments.get(el_idx))
        assignment_change_rate = changed / len(new_assignments) if new_assignments else 0
        
        if assignment_change_rate <= assignment_tol:
            return True, "assignment_stable"
    
    # Parameter stability
    if old_params is not None and new_params is not None:
        param_change = np.linalg.norm(new_params - old_params) / (np.linalg.norm(old_params) + 1e-12)
        if param_change <= param_tol:
            return True, "params_stable"
    
    # Cost stability
    if old_cost is not None and new_cost is not None and np.isfinite(old_cost) and np.isfinite(new_cost):
        if old_cost > 0:
            cost_change = abs(new_cost - old_cost) / old_cost
            if cost_change <= cost_tol:
                return True, "cost_stable"
    
    return False, "continuing"

def iterative_align_and_assign(el_centers, door_centers, max_iter=10, 
                              anisotropic=False, verbose=True):
    """Iterative alignment and assignment with alternating minimization"""
    
    if verbose:
        print(f"\nStarting iterative alignment (max_iter={max_iter})")
    
    # 1. Initialize with robust alignment
    initial_params, initial_cost = align_detections(door_centers, el_centers, 
                                                   anisotropic=anisotropic, 
                                                   trim_frac=0.75, max_iter=10)
    
    if initial_params is None:
        return None, None, []
    
    params = initial_params.copy()
    prev_matches = None
    prev_params = None
    prev_cost = None
    iteration_history = []
    
    for iteration in range(max_iter):
        if verbose:
            print(f"  Iteration {iteration + 1}/{max_iter}")
        
        # 2. Apply current transform
        scale, _, tx, ty = params
        aligned_el = apply_transform_params(el_centers, scale, tx, ty)
        
        # 3. Compute adaptive gating radius
        if prev_matches is not None:
            residuals = compute_residuals(aligned_el, door_centers, prev_matches)
            gating_radius = adaptive_gating_radius(residuals, factor=3.0)
        else:
            gating_radius = np.inf  # No gating on first iteration
        
        # 4. Assign with gating
        new_matches = assign_with_gating(aligned_el, door_centers, 
                                       max_radius=gating_radius, method='hungarian')
        
        # 5. Refit parameters from matches (with safety check)
        valid_matches = [m for m in new_matches if m[1] != -1]
        if len(valid_matches) >= 2:
            new_params_raw = robust_refit_from_matches(el_centers, door_centers, new_matches,
                                                      trim_fraction=0.8, anisotropic=anisotropic)
            # 6. Apply damped update
            new_params = damped_update(params, new_params_raw, alpha=0.6)
        else:
            if verbose:
                print(f"    Warning: Only {len(valid_matches)} valid matches, keeping current params")
            new_params = params.copy()  # Keep current params if too few matches
        
        # 7. Compute cost and health metrics
        avg_cost = np.mean([dist for _, _, dist in valid_matches]) if valid_matches else np.inf
        unmatched_count = len([m for m in new_matches if m[1] == -1])
        unmatched_pct = (unmatched_count / len(new_matches)) * 100 if new_matches else 0
        
        # 8. Store iteration info
        iteration_info = {
            'iteration': iteration + 1,
            'params': new_params.tolist(),
            'num_matches': len(valid_matches),
            'num_unmatched': unmatched_count,
            'unmatched_pct': float(unmatched_pct),
            'avg_cost': float(avg_cost),
            'gating_radius': float(gating_radius) if np.isfinite(gating_radius) else None
        }
        iteration_history.append(iteration_info)
        
        if verbose:
            print(f"    Matches: {len(valid_matches)}, Cost: {avg_cost:.2f}, Unmatched: {unmatched_pct:.1f}%, Radius: {gating_radius:.1f}")
        
        # 9. Check convergence BEFORE updating (use prev vs new)
        converged, reason = check_convergence(prev_matches, new_matches, prev_params, new_params, 
                                            prev_cost, avg_cost)
        if converged and iteration > 0:  # Don't converge on first iteration
            if verbose:
                print(f"    Converged: {reason}")
            # Update final values before breaking
            prev_matches = new_matches
            prev_params = new_params
            prev_cost = avg_cost
            break
        
        # 10. Update for next iteration
        prev_matches = new_matches
        prev_params = new_params
        prev_cost = avg_cost
        params = new_params
    
    return (prev_params if prev_params is not None else params,
            prev_matches if prev_matches is not None else new_matches if 'new_matches' in locals() else None, 
            iteration_history)

def align_detections_tool(project_id: int, sheet_code: str = None):
    """
    Align EL and DOOR detections using align_detections logic
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
        
        # EXACT align_detections.py logic
        door_data, el_data = load_detections('door_detections.json', 'el_detections.json')
        
        door_centers = extract_centers(door_data)
        el_centers = extract_centers(el_data)

        print(f"Found {len(door_centers)} DOOR centers and {len(el_centers)} EL centers")
        
        if len(door_centers) == 0:
            return {
                'success': False,
                'error': 'No DOOR detections found'
            }
        if len(el_centers) == 0:
            return {
                'success': False,
                'error': 'No EL detections found'
            }
        
        print("Door centers:")
        for i, center in enumerate(door_centers):
            print(f"  DOOR_{i+1}: ({center[0]:.1f}, {center[1]:.1f})")
        
        print("EL centers:")
        for i, center in enumerate(el_centers):
            print(f"  EL_{i+1}: ({center[0]:.1f}, {center[1]:.1f})")
        
        # Use iterative alignment instead of single-shot
        params, matches, history = iterative_align_and_assign(el_centers, door_centers, 
                                                             max_iter=10, anisotropic=False, verbose=True)
        
        if params is not None and matches is not None:
            scale, rotation, tx, ty = params
            print(f"\nFinal alignment parameters:")
            print(f"  Scale: {scale:.3f}")
            print(f"  Rotation: {rotation:.3f} rad ({np.degrees(rotation):.1f}°)")
            print(f"  Translation: ({tx:.1f}, {ty:.1f})")
            print(f"  Iterations: {len(history)}")
            
            aligned_el_centers = apply_transform_params(el_centers, scale, tx, ty)
            
            # Extract explicit matches from final iteration
            explicit_matches = []
            final_cost = 0.0
            for el_idx, door_idx, dist in matches:
                if door_idx != -1:  # valid match
                    explicit_matches.append((el_idx, door_idx, dist))
                    final_cost += dist
            
            avg_cost = final_cost / len(explicit_matches) if explicit_matches else 0.0
            
            print(f"  Final matches: {len(explicit_matches)}")
            print(f"  Final cost: {avg_cost:.2f}")
            print(f"  Unmatched EL: {len(el_centers) - len(explicit_matches)}")
            
            alignment_result = {
                "transformation": {
                    "scale": float(scale),
                    "rotation_rad": float(rotation),
                    "rotation_deg": float(np.degrees(rotation)),
                    "translation_x": float(tx),
                    "translation_y": float(ty)
                },
                "cost": float(avg_cost),
                "iterations": len(history),
                "iteration_history": history,  # Already converted to lists in iteration_info
                "el_centers_original": el_centers.tolist(),
                "el_centers_aligned": aligned_el_centers.tolist(),
                "door_centers": door_centers.tolist(),
                "explicit_matches": [
                    {
                        "el_idx": int(el_idx),
                        "door_idx": int(door_idx),
                        "distance": float(dist)
                    }
                    for el_idx, door_idx, dist in explicit_matches
                ]
            }
            
            with open('alignment_result.json', 'w') as f:
                json.dump(alignment_result, f, indent=2)
            
            visualize_alignment(door_centers, el_centers, aligned_el_centers)
            print("\nIterative alignment complete. Results saved to 'alignment_result.json' and 'alignment_visualization.png'")
            print(f"Explicit matches saved in 'explicit_matches' field of JSON")
        
            db.close()
            
            return {
                'success': True,
                'total_door_centers': len(door_centers),
                'total_el_centers': len(el_centers),
                'total_matches': len(explicit_matches),
                'transformation': alignment_result["transformation"],
                'cost': avg_cost,
                'iterations': len(history),
                'explicit_matches': alignment_result["explicit_matches"],
                'unmatched_el': len(el_centers) - len(explicit_matches)
            }
        else:
            print("Alignment failed")
            visualize_alignment(door_centers, el_centers)
            db.close()
            return {
                'success': False,
                'error': 'Alignment failed'
            }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == "__main__":
    main()