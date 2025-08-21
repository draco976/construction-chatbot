import json
import numpy as np
from collections import Counter

def calculate_reference_candidates(pairs):
    """Calculate potential reference values from all pairs"""
    references = []
    
    for pair in pairs:
        try:
            decimal_val = float(str(pair.get('decimal_value', '0')).strip('"'))
            inches_val = float(str(pair.get('inches_value', '0')).strip('"'))
            
            # reference = decimal - inches
            reference = decimal_val - inches_val
            references.append(reference)
            
        except (ValueError, TypeError):
            continue
    
    return references

def find_best_reference(references, tolerance=0.1):
    """Find the most common reference value within tolerance"""
    if not references:
        return None, []
    
    # Round to nearest 0.01 to group similar values
    rounded_refs = [round(ref, 2) for ref in references]
    
    # Count occurrences
    ref_counts = Counter(rounded_refs)
    
    # Find the most common reference
    best_ref, best_count = ref_counts.most_common(1)[0]
    
    # Find all references within tolerance of the best one
    consistent_refs = [ref for ref in references if abs(ref - best_ref) <= tolerance]
    
    return best_ref, consistent_refs

def analyze_pairs_with_reference(pairs, reference, tolerance=0.1):
    """Analyze pairs against the reference and identify mistakes"""
    correct_pairs = []
    mistake_pairs = []
    
    for i, pair in enumerate(pairs):
        try:
            decimal_val = float(str(pair.get('decimal_value', '0')).strip('"')) * 12
            inches_val = float(str(pair.get('inches_value', '0')).strip('"'))
            
            # Calculate expected decimal based on reference
            expected_decimal = reference * 12 + inches_val
            
            # Check if actual decimal matches expected (within tolerance)
            error = abs(decimal_val - expected_decimal)
            
            if error <= tolerance:
                correct_pairs.append({
                    'pair_id': i + 1,
                    'decimal': decimal_val,
                    'inches': inches_val,
                    'expected_decimal': expected_decimal,
                    'error': error,
                    'status': 'CORRECT'
                })
            else:
                # This is a mistake - suggest correction
                mistake_pairs.append({
                    'pair_id': i + 1,
                    'decimal': decimal_val,
                    'inches': inches_val,
                    'expected_decimal': expected_decimal,
                    'error': error,
                    'status': 'MISTAKE',
                    'suggested_decimal': expected_decimal
                })
                
        except (ValueError, TypeError):
            mistake_pairs.append({
                'pair_id': i + 1,
                'decimal': pair.get('decimal_value', 'N/A'),
                'inches': pair.get('inches_value', 'N/A'),
                'expected_decimal': 'N/A',
                'error': 'N/A',
                'status': 'INVALID_DATA'
            })
    
    return correct_pairs, mistake_pairs

def load_and_display_pairs(json_file_path='decimal_inches_pairs.json'):
    """Load decimal-inches pairs and analyze with reference calculation"""
    
    try:
        with open(json_file_path, 'r') as f:
            data = json.load(f)
        
        pairs = data.get('pairs', [])
        total_pairs = len(pairs)
        
        print(f"Total pairs: {total_pairs}")
        print("=" * 60)
        
        # Calculate reference values
        references = calculate_reference_candidates(pairs)
        
        if not references:
            print("Error: No valid numerical pairs found.")
            return
        
        # Find the best reference
        best_reference, consistent_refs = find_best_reference(references)
        
        print(f"REFERENCE ANALYSIS:")
        print(f"Most likely reference value: {best_reference:.2f}")
        print(f"Number of pairs supporting this reference: {len(consistent_refs)}/{len(references)}")
        print(f"Reference equation: decimal = {best_reference:.2f} + inches")
        print("=" * 60)
        
        # Analyze pairs with the reference
        correct_pairs, mistake_pairs = analyze_pairs_with_reference(pairs, best_reference)
        
        print(f"\nCORRECT PAIRS ({len(correct_pairs)}):")
        print("-" * 60)
        print("Pair ID | Decimal | Inches | Expected | Error")
        print("-" * 60)
        for pair in correct_pairs:
            print(f"{pair['pair_id']:<7} | {pair['decimal']:<7} | {pair['inches']:<6} | {pair['expected_decimal']:<8.2f} | {pair['error']:<5.3f}")
        
        if mistake_pairs:
            print(f"\nMISTAKES FOUND ({len(mistake_pairs)}):")
            print("-" * 70)
            print("Pair ID | Current | Inches | Expected | Error  | Suggested")
            print("-" * 70)
            for pair in mistake_pairs:
                if pair['status'] == 'MISTAKE':
                    print(f"{pair['pair_id']:<7} | {pair['decimal']:<7} | {pair['inches']:<6} | {pair['expected_decimal']:<8.2f} | {pair['error']:<6.3f} | {pair['suggested_decimal']:<9.2f}")
                else:
                    print(f"{pair['pair_id']:<7} | {pair['decimal']:<7} | {pair['inches']:<6} | INVALID DATA")
        
        print("=" * 60)
        print(f"SUMMARY:")
        print(f"Reference value: {best_reference:.2f}")
        print(f"Correct pairs: {len(correct_pairs)}")
        print(f"Mistakes found: {len(mistake_pairs)}")
        print(f"Accuracy: {len(correct_pairs)/total_pairs*100:.1f}%")
        
        # Save results
        results = {
            'reference_value': best_reference,
            'total_pairs': total_pairs,
            'correct_pairs': len(correct_pairs),
            'mistakes': len(mistake_pairs),
            'accuracy_percent': len(correct_pairs)/total_pairs*100,
            'correct_data': correct_pairs,
            'mistakes_data': mistake_pairs
        }
        
        with open('reference_analysis.json', 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"\nDetailed analysis saved to: reference_analysis.json")
        
    except FileNotFoundError:
        print(f"Error: File '{json_file_path}' not found.")
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON in '{json_file_path}'.")
    except Exception as e:
        print(f"Error: {str(e)}")

def display_pairs_tool(project_id: int, sheet_code: str = None):
    """
    Display pairs analysis using display_pairs logic
    """
    try:
        from database import SessionLocal, Sheet, Document, Project
        from sqlalchemy import func
        
        db = SessionLocal()
        
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
        
        # EXACT display_pairs.py logic
        try:
            with open('decimal_inches_pairs.json', 'r') as f:
                data = json.load(f)
            
            pairs = data.get('pairs', [])
            total_pairs = len(pairs)
            
            print(f"Total pairs: {total_pairs}")
            print("=" * 60)
            
            # Calculate reference values
            references = calculate_reference_candidates(pairs)
            
            if not references:
                db.close()
                return {
                    'success': False,
                    'error': 'No valid numerical pairs found.'
                }
            
            # Find the best reference
            best_reference, consistent_refs = find_best_reference(references)
            
            print(f"REFERENCE ANALYSIS:")
            print(f"Most likely reference value: {best_reference:.2f}")
            print(f"Number of pairs supporting this reference: {len(consistent_refs)}/{len(references)}")
            print(f"Reference equation: decimal = {best_reference:.2f} + inches")
            print("=" * 60)
            
            # Analyze pairs with the reference
            correct_pairs, mistake_pairs = analyze_pairs_with_reference(pairs, best_reference)
            
            print(f"\nCORRECT PAIRS ({len(correct_pairs)}):")
            print("-" * 60)
            print("Pair ID | Decimal | Inches | Expected | Error")
            print("-" * 60)
            for pair in correct_pairs:
                print(f"{pair['pair_id']:<7} | {pair['decimal']:<7} | {pair['inches']:<6} | {pair['expected_decimal']:<8.2f} | {pair['error']:<5.3f}")
            
            if mistake_pairs:
                print(f"\nMISTAKES FOUND ({len(mistake_pairs)}):")
                print("-" * 70)
                print("Pair ID | Current | Inches | Expected | Error  | Suggested")
                print("-" * 70)
                for pair in mistake_pairs:
                    if pair['status'] == 'MISTAKE':
                        print(f"{pair['pair_id']:<7} | {pair['decimal']:<7} | {pair['inches']:<6} | {pair['expected_decimal']:<8.2f} | {pair['error']:<6.3f} | {pair['suggested_decimal']:<9.2f}")
                    else:
                        print(f"{pair['pair_id']:<7} | {pair['decimal']:<7} | {pair['inches']:<6} | INVALID DATA")
            
            print("=" * 60)
            print(f"SUMMARY:")
            print(f"Reference value: {best_reference:.2f}")
            print(f"Correct pairs: {len(correct_pairs)}")
            print(f"Mistakes found: {len(mistake_pairs)}")
            print(f"Accuracy: {len(correct_pairs)/total_pairs*100:.1f}%")
            
            # Save results
            results = {
                'reference_value': best_reference,
                'total_pairs': total_pairs,
                'correct_pairs': len(correct_pairs),
                'mistakes': len(mistake_pairs),
                'accuracy_percent': len(correct_pairs)/total_pairs*100,
                'correct_data': correct_pairs,
                'mistakes_data': mistake_pairs
            }
            
            with open('reference_analysis.json', 'w') as f:
                json.dump(results, f, indent=2)
            
            print(f"\nDetailed analysis saved to: reference_analysis.json")
            
            db.close()
            
            return {
                'success': True,
                'reference_value': best_reference,
                'total_pairs': total_pairs,
                'correct_pairs': len(correct_pairs),
                'mistakes': len(mistake_pairs),
                'accuracy_percent': len(correct_pairs)/total_pairs*100,
                'reference_equation': f"decimal = {best_reference:.2f} + inches",
                'supporting_pairs': len(consistent_refs),
                'correct_data': correct_pairs,
                'mistakes_data': mistake_pairs
            }
            
        except FileNotFoundError:
            db.close()
            return {
                'success': False,
                'error': 'File decimal_inches_pairs.json not found.'
            }
        except json.JSONDecodeError:
            db.close()
            return {
                'success': False,
                'error': 'Invalid JSON in decimal_inches_pairs.json.'
            }
            
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

if __name__ == "__main__":
    load_and_display_pairs()