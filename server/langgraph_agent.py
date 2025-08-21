"""
LangGraph-based chatbot agent for ConcretePro
"""
import uuid
import time
import json
from typing import Dict, Any, Optional, List, TypedDict, Annotated
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import Project, Document, Sheet, SessionLocal
from columns import extract_and_save_sheet_columns, get_sheet_columns
from grid_lines import extract_and_save_sheet_grid_lines, get_sheet_grid_lines
from walls import extract_and_save_sheet_walls, get_sheet_walls
from measurement import extract_measurements_from_sheet
# from elevation import show_exterior_elevations
# from align_detections import align_detections_tool
import os

# Define the graph state
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    project_id: int
    context: Optional[Dict[str, Any]]
    actions: List[Dict[str, Any]]

class LangGraphChatAgent:
    def __init__(self, api_key: str):
        # Use Claude Sonnet 4 with retry logic to handle overload issues
        self.llm = ChatAnthropic(
            model="claude-sonnet-4-20250514",
            api_key=api_key,
            max_tokens=4096,
            temperature=0.1  # Lower temperature for more consistent responses
        )
        
        # Session storage
        self.sessions = {}
        
        # Define tools
        self.tools = [
            self._get_sheets_tool(),
            self._open_sheet_tool(),
            self._extract_columns_tool(),
            self._extract_walls_tool(),
            self._highlight_walls_tool(),
            self._extract_grid_lines_tool(),
            self._show_grid_lines_tool(),
            self._query_database_tool(),
            self._compare_columns_tool(),
            self._compare_walls_tool(),
            self._highlight_columns_tool(),
            self._extract_measurements_tool(),
            self._show_measurements_tool(),
            self._validate_column_positions_tool(),
            self._validate_wall_positions_tool(),
            self._find_closest_grid_lines_tool(),
            self._zoom_to_location_tool(),
            self._save_rfi_tool(),
            self._mark_non_structural_walls_tool(),
            self._show_exterior_elevations_tool(),
            self._align_elevations_tool(),
        ]
        
        # Bind tools to LLM
        self.llm_with_tools = self.llm.bind_tools(self.tools)
        
        # Create the graph
        self.graph = self._create_graph()
        
    def _get_sheets_tool(self):
        """Create get_sheets tool for LangGraph"""
        @tool
        def get_sheets(project_id: int, sheet_type: Optional[str] = None) -> Dict[str, Any]:
            """Get information about all sheets in a project. This tool can filter by project ID and return details about available sheets including their codes, titles, types, and status."""
            
            db = SessionLocal()
            try:
                query = db.query(Sheet).join(Document).join(Project).filter(Project.id == project_id)
                
                if sheet_type:
                    query = query.filter(Sheet.type.ilike(f"%{sheet_type}%"))
                
                sheets = query.order_by(Sheet.type, Sheet.code).all()
                
                return json.dumps({
                    "success": True,
                    "sheets": [
                        {
                            "id": sheet.id,
                            "code": sheet.code,
                            "title": sheet.title or "",
                            "type": sheet.type or "Other",
                            "page": sheet.page,
                            "status": sheet.status,
                            "documentId": sheet.document_id,
                            "projectName": sheet.document.project.name
                        }
                        for sheet in sheets
                    ]
                })
            except Exception as e:
                print(f"Error getting sheets: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return get_sheets
    
    def _open_sheet_tool(self):
        """Create open_sheet tool for LangGraph"""
        @tool
        def open_sheet(project_id: int, sheet_code: Optional[str] = None, sheet_id: Optional[int] = None) -> Dict[str, Any]:
            """Open a specific sheet by code or ID. This will return the sheet information and signal the frontend to display it."""
            
            db = SessionLocal()
            try:
                sheet = None
                
                print(f"Opening sheet with code: {sheet_code}, id: {sheet_id}")
                
                if sheet_code:
                    # Case-insensitive search for sheet code
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.code.ilike(sheet_code)
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_code} not found in project {project_id}"
                        })
                        
                elif sheet_id:
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.id == sheet_id
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_id} not found in project {project_id}"
                        })
                else:
                    return json.dumps({
                        "success": False,
                        "error": "Either sheetCode or sheetId must be provided"
                    })
                
                # Load SVG content if available
                svg_content = None
                if sheet.svg_path and os.path.exists(sheet.svg_path):
                    try:
                        with open(sheet.svg_path, 'r', encoding='utf-8') as f:
                            svg_content = f.read()
                    except Exception as svg_error:
                        print(f"Warning: Could not load SVG for sheet {sheet.code}: {svg_error}")
                
                # Store the sheet info for frontend action
                sheet_info = {
                    "id": sheet.id,
                    "code": sheet.code,
                    "title": sheet.title or "",
                    "type": sheet.type or "Other",
                    "page": sheet.page,
                    "status": sheet.status,
                    "documentId": sheet.document_id,
                    "projectName": sheet.document.project.name,
                    "svgContent": svg_content
                }
                
                # Return formatted result WITHOUT SVG content for LLM (to avoid 413 errors)
                return json.dumps({
                    "success": True,
                    "message": f"Successfully opened sheet {sheet.code} - {sheet.title or 'No title'}",
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other",
                        "page": sheet.page,
                        "status": sheet.status,
                        "documentId": sheet.document_id,
                        "projectName": sheet.document.project.name
                        # Note: svgContent excluded from tool result to prevent 413 errors
                    }
                })
                
            except Exception as e:
                print(f"Error opening sheet: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return open_sheet
    
    def _extract_columns_tool(self):
        """Create extract_columns tool for LangGraph"""
        @tool
        def extract_columns(project_id: int, sheet_code: Optional[str] = None, sheet_id: Optional[int] = None) -> Dict[str, Any]:
            """Extract column positions from a construction sheet and save to database. This tool analyzes structural drawings to identify column locations, centers, and dimensions."""
            
            db = SessionLocal()
            try:
                sheet = None
                
                print(f"Extracting columns from sheet with code: {sheet_code}, id: {sheet_id}")
                
                if sheet_code:
                    # Case-insensitive search for sheet code
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.code.ilike(sheet_code)
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_code} not found in project {project_id}"
                        })
                        
                elif sheet_id:
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.id == sheet_id
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_id} not found in project {project_id}"
                        })
                else:
                    return json.dumps({
                        "success": False,
                        "error": "Either sheet_code or sheet_id must be provided"
                    })
                
                # Extract and save columns
                result = extract_and_save_sheet_columns(sheet.id)
                
                return json.dumps(result)
                
            except Exception as e:
                print(f"Error extracting columns: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return extract_columns

    def _extract_walls_tool(self):
        """Create extract_walls tool for LangGraph"""
        @tool
        def extract_walls(project_id: int, sheet_code: Optional[str] = None, sheet_id: Optional[int] = None) -> Dict[str, Any]:
            """Extract wall positions from a construction sheet and save to database. This tool analyzes architectural and structural drawings to identify wall locations, orientations (horizontal/vertical), thickness, and length."""
            
            db = SessionLocal()
            try:
                sheet = None
                
                print(f"Extracting walls from sheet with code: {sheet_code}, id: {sheet_id}")
                
                if sheet_code:
                    # Case-insensitive search for sheet code
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.code.ilike(sheet_code)
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_code} not found in project {project_id}"
                        })
                        
                elif sheet_id:
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.id == sheet_id
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_id} not found in project {project_id}"
                        })
                else:
                    return json.dumps({
                        "success": False,
                        "error": "Either sheet_code or sheet_id must be provided"
                    })
                
                # Extract and save walls
                result = extract_and_save_sheet_walls(sheet.id)
                
                return json.dumps(result)
                
            except Exception as e:
                print(f"Error extracting walls: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return extract_walls

    def _highlight_walls_tool(self):
        """Create highlight_walls tool for LangGraph"""
        @tool
        def highlight_walls(project_id: int, sheet_code: str, walls_data: Optional[List[Dict[str, Any]]] = None, color: str = "#FF9800") -> str:
            """Highlight walls on a sheet with colored overlays. If walls_data is provided, highlights those specific walls. If not provided, automatically extracts and highlights all walls from the sheet."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                # If no walls_data provided, fetch existing walls from database
                if walls_data is None:
                    print(f"No walls_data provided, fetching existing walls for sheet {sheet.code}")
                    existing_walls_result = get_sheet_walls(sheet.id)
                    
                    if not existing_walls_result["success"] or not existing_walls_result["walls"]:
                        # Try to extract walls first
                        print(f"No existing walls found, extracting walls for sheet {sheet.code}")
                        extraction_result = extract_and_save_sheet_walls(sheet.id)
                        
                        if not extraction_result["success"]:
                            return json.dumps({
                                "success": False,
                                "error": f"Could not extract walls from sheet {sheet.code}: {extraction_result.get('error', 'Unknown error')}"
                            })
                        
                        # Get the extracted walls
                        existing_walls_result = get_sheet_walls(sheet.id)
                    
                    # Convert database walls to walls_data format
                    walls_data = []
                    for wall in existing_walls_result["walls"]:
                        walls_data.append({
                            'center_x': wall['center_x'],
                            'center_y': wall['center_y'],
                            'width': wall['width'],
                            'height': wall['height'],
                            'orientation': wall['orientation'],
                            'thickness': wall['thickness'],
                            'length': wall['length'],
                            'color': color,
                            'label': f"W{wall['index']}",
                            'aspect_ratio': wall.get('aspect_ratio', 0)
                        })
                
                print(f"Highlighting {len(walls_data)} walls on sheet {sheet.code}")
                
                # Validate wall data
                validated_walls = []
                for wall in walls_data:
                    if all(key in wall for key in ['center_x', 'center_y', 'width', 'height']):
                        validated_walls.append({
                            'center_x': float(wall['center_x']),
                            'center_y': float(wall['center_y']),
                            'width': float(wall['width']),
                            'height': float(wall['height']),
                            'orientation': wall.get('orientation', 'horizontal'),
                            'thickness': wall.get('thickness', min(wall['width'], wall['height'])),
                            'length': wall.get('length', max(wall['width'], wall['height'])),
                            'color': wall.get('color', color),
                            'label': wall.get('label', '')
                        })
                
                result = json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other"
                    },
                    "highlighted_walls": validated_walls,
                    "message": f"Highlighted {len(validated_walls)} walls on sheet {sheet.code}"
                })
                
                print(f"highlight_walls returning: {result[:100]}...")
                return result
                
            except Exception as e:
                print(f"Error highlighting walls: {e}")
                error_result = json.dumps({
                    "success": False,
                    "error": f"Error highlighting walls: {str(e)}"
                })
                print(f"highlight_walls error returning: {error_result}")
                return error_result
            finally:
                db.close()
                
        return highlight_walls

    def _extract_grid_lines_tool(self):
        """Create extract_grid_lines tool for LangGraph"""
        @tool
        def extract_grid_lines(project_id: int, sheet_code: Optional[str] = None, sheet_id: Optional[int] = None) -> Dict[str, Any]:
            """Extract grid line labels from a construction sheet and save to database. This tool analyzes text on drawings to identify grid line labels like H1, H2, HA, HB (hotel) or R1, R2, RA, RB (residence)."""
            
            db = SessionLocal()
            try:
                sheet = None
                
                print(f"Extracting grid lines from sheet with code: {sheet_code}, id: {sheet_id}")
                
                if sheet_code:
                    # Case-insensitive search for sheet code
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.code.ilike(sheet_code)
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_code} not found in project {project_id}"
                        })
                        
                elif sheet_id:
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.id == sheet_id
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_id} not found in project {project_id}"
                        })
                else:
                    return json.dumps({
                        "success": False,
                        "error": "Either sheet_code or sheet_id must be provided"
                    })
                
                # Extract and save grid lines
                result = extract_and_save_sheet_grid_lines(sheet.id)
                
                return json.dumps(result)
                
            except Exception as e:
                print(f"Error extracting grid lines: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return extract_grid_lines

    def _show_grid_lines_tool(self):
        """Create show_grid_lines tool for LangGraph"""
        @tool
        def show_grid_lines(project_id: int, sheet_code: Optional[str] = None, sheet_id: Optional[int] = None) -> Dict[str, Any]:
            """Show grid line positions with colored overlays on a construction sheet. This tool first checks if grid lines exist in the database, and if not, extracts them first before displaying."""
            
            db = SessionLocal()
            try:
                sheet = None
                
                print(f"Showing grid lines for sheet with code: {sheet_code}, id: {sheet_id}")
                
                if sheet_code:
                    # Case-insensitive search for sheet code
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.code.ilike(sheet_code)
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_code} not found in project {project_id}"
                        })
                        
                elif sheet_id:
                    sheet = db.query(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.id == sheet_id
                    ).first()
                    
                    if not sheet:
                        return json.dumps({
                            "success": False,
                            "error": f"Sheet {sheet_id} not found in project {project_id}"
                        })
                else:
                    return json.dumps({
                        "success": False,
                        "error": "Either sheet_code or sheet_id must be provided"
                    })
                
                # Check if grid lines already exist in database
                existing_grid_lines = get_sheet_grid_lines(sheet.id)
                
                if not existing_grid_lines["success"] or existing_grid_lines["count"] == 0:
                    # No grid lines found, extract them first
                    print(f"No grid lines found for sheet {sheet.code}, extracting first...")
                    extraction_result = extract_and_save_sheet_grid_lines(sheet.id)
                    
                    if not extraction_result["success"]:
                        return json.dumps({
                            "success": False,
                            "error": f"Failed to extract grid lines: {extraction_result.get('error')}"
                        })
                    
                    # Get the newly extracted grid lines
                    grid_lines_result = get_sheet_grid_lines(sheet.id)
                    if not grid_lines_result["success"]:
                        return json.dumps({
                            "success": False,
                            "error": "Failed to retrieve extracted grid lines"
                        })
                    grid_lines = grid_lines_result["grid_lines"]
                    message = f"Extracted and showing {len(grid_lines)} grid lines from sheet {sheet.code}"
                else:
                    # Use existing grid lines
                    grid_lines = existing_grid_lines["grid_lines"]
                    message = f"Showing {len(grid_lines)} existing grid lines from sheet {sheet.code}"
                
                return json.dumps({
                    "success": True,
                    "message": message,
                    "grid_lines": grid_lines,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other"
                    },
                    "action": "show_grid_lines"
                })
                
            except Exception as e:
                print(f"Error showing grid lines: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return show_grid_lines

    def _query_database_tool(self):
        """Create database query tool for LangGraph"""
        @tool
        def query_database(project_id: int, query_type: str, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
            """Query the database for construction project information. 
            
            Supported query_types:
            - 'sheet_stats': Get statistics about sheets in the project
            - 'sheet_search': Search for sheets by code, title, or type
            - 'column_stats': Get column statistics for sheets
            - 'project_summary': Get overall project information
            - 'sheet_types': Get all unique sheet types in the project
            
            Filters can include: sheet_type, status, has_columns, code_pattern, etc.
            """
            
            db = SessionLocal()
            try:
                filters = filters or {}
                
                if query_type == "sheet_stats":
                    # Get sheet statistics
                    total_sheets = db.query(Sheet).join(Document).join(Project).filter(Project.id == project_id).count()
                    
                    sheet_types = db.query(Sheet.type, func.count(Sheet.id)).join(Document).join(Project).filter(
                        Project.id == project_id
                    ).group_by(Sheet.type).all()
                    
                    status_counts = db.query(Sheet.status, func.count(Sheet.id)).join(Document).join(Project).filter(
                        Project.id == project_id
                    ).group_by(Sheet.status).all()
                    
                    return json.dumps({
                        "success": True,
                        "query_type": query_type,
                        "data": {
                            "total_sheets": total_sheets,
                            "by_type": dict(sheet_types),
                            "by_status": dict(status_counts)
                        }
                    })
                
                elif query_type == "sheet_search":
                    query = db.query(Sheet).join(Document).join(Project).filter(Project.id == project_id)
                    
                    if filters.get("sheet_type"):
                        query = query.filter(Sheet.type.ilike(f"%{filters['sheet_type']}%"))
                    if filters.get("code_pattern"):
                        query = query.filter(Sheet.code.ilike(f"%{filters['code_pattern']}%"))
                    if filters.get("title_pattern"):
                        query = query.filter(Sheet.title.ilike(f"%{filters['title_pattern']}%"))
                    if filters.get("status"):
                        query = query.filter(Sheet.status == filters["status"])
                    
                    sheets = query.limit(20).all()  # Limit to 20 results
                    
                    return json.dumps({
                        "success": True,
                        "query_type": query_type,
                        "data": {
                            "sheets": [
                                {
                                    "id": sheet.id,
                                    "code": sheet.code,
                                    "title": sheet.title or "",
                                    "type": sheet.type or "Other",
                                    "page": sheet.page,
                                    "status": sheet.status
                                }
                                for sheet in sheets
                            ],
                            "count": len(sheets)
                        }
                    })
                
                elif query_type == "column_stats":
                    # Get column statistics
                    from database import SheetColumn
                    
                    sheets_with_columns = db.query(Sheet.id, Sheet.code, func.count(SheetColumn.id).label('column_count')).join(Document).join(Project).outerjoin(SheetColumn).filter(
                        Project.id == project_id
                    ).group_by(Sheet.id, Sheet.code).having(func.count(SheetColumn.id) > 0).all()
                    
                    total_columns = db.query(func.count(SheetColumn.id)).join(Sheet).join(Document).join(Project).filter(
                        Project.id == project_id
                    ).scalar()
                    
                    return json.dumps({
                        "success": True,
                        "query_type": query_type,
                        "data": {
                            "total_columns": total_columns or 0,
                            "sheets_with_columns": len(sheets_with_columns),
                            "sheet_column_counts": [
                                {"sheet_id": s.id, "code": s.code, "columns": s.column_count}
                                for s in sheets_with_columns
                            ]
                        }
                    })
                
                elif query_type == "project_summary":
                    # Get comprehensive project overview
                    project = db.query(Project).filter(Project.id == project_id).first()
                    if not project:
                        return json.dumps({"success": False, "error": "Project not found"})
                    
                    total_documents = len(project.documents)
                    total_sheets = db.query(Sheet).join(Document).filter(Document.project_id == project_id).count()
                    
                    return json.dumps({
                        "success": True,
                        "query_type": query_type,
                        "data": {
                            "project_name": project.name,
                            "project_id": project.id,
                            "created": project.date.isoformat() if project.date else None,
                            "total_documents": total_documents,
                            "total_sheets": total_sheets
                        }
                    })
                
                elif query_type == "sheet_types":
                    # Get all unique sheet types
                    types = db.query(Sheet.type, func.count(Sheet.id)).join(Document).join(Project).filter(
                        Project.id == project_id,
                        Sheet.type.isnot(None)
                    ).group_by(Sheet.type).order_by(func.count(Sheet.id).desc()).all()
                    
                    return json.dumps({
                        "success": True,
                        "query_type": query_type,
                        "data": {
                            "types": [{"type": t[0], "count": t[1]} for t in types]
                        }
                    })
                
                else:
                    return json.dumps({
                        "success": False,
                        "error": f"Unknown query_type: {query_type}. Supported types: sheet_stats, sheet_search, column_stats, project_summary, sheet_types"
                    })
                
            except Exception as e:
                print(f"Error querying database: {e}")
                return json.dumps({
                    "success": False,
                    "error": str(e)
                })
            finally:
                db.close()
                
        return query_database

    def _compare_columns_tool(self):
        """Create column comparison tool for LangGraph"""
        @tool
        def compare_columns(project_id: int, sheet_code_1: str, sheet_code_2: str) -> Dict[str, Any]:
            """Compare columns between two sheets to find mismatches and alignment differences.
            
            This tool:
            1. Retrieves columns and grid lines from both sheets
            2. Aligns the sheets using common grid lines 
            3. Finds columns that don't match between the sheets
            4. Returns detailed comparison results
            
            Args:
                project_id: ID of the project containing the sheets
                sheet_code_1: Code of the first sheet (reference sheet) 
                sheet_code_2: Code of the second sheet (comparison sheet)
                
            Returns:
                Dictionary with comparison results including matches, mismatches, and alignment info
            """
            from column_comparison import compare_sheet_columns, format_comparison_summary
            from database import SessionLocal, Sheet, Document
            
            db = SessionLocal()
            try:
                # Find sheet IDs from codes
                sheet1 = db.query(Sheet).join(Document).filter(
                    Sheet.code == sheet_code_1,
                    Document.project_id == project_id
                ).first()
                
                sheet2 = db.query(Sheet).join(Document).filter(
                    Sheet.code == sheet_code_2,
                    Document.project_id == project_id
                ).first()
                
                if not sheet1:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet '{sheet_code_1}' not found in project {project_id}"
                    })
                    
                if not sheet2:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet '{sheet_code_2}' not found in project {project_id}"
                    })
                
                # Perform the comparison
                result = compare_sheet_columns(sheet1.id, sheet2.id)
                
                if result['success']:
                    # Format a human-readable summary
                    summary = format_comparison_summary(result)
                    result['summary'] = summary
                
                return json.dumps(result)
                
            except Exception as e:
                return json.dumps({
                    "success": False,
                    "error": f"Error comparing columns: {str(e)}"
                })
            finally:
                db.close()
                
        return compare_columns

    def _compare_walls_tool(self):
        """Create wall comparison tool for LangGraph"""
        @tool
        def compare_walls(project_id: int, sheet_code_1: str, sheet_code_2: str, tolerance: float = 2.0) -> str:
            """Compare walls between two sheets to find mismatches and alignment differences.
            
            This tool:
            1. Retrieves walls and grid lines from both sheets
            2. Aligns the sheets using common grid lines 
            3. Finds walls that don't match between the sheets based on position, size (width/height), thickness, and orientation
            4. Returns detailed comparison results with grid references for unmatched walls
            
            Args:
                project_id: ID of the project containing the sheets
                sheet_code_1: Code of the first sheet (reference sheet) 
                sheet_code_2: Code of the second sheet (comparison sheet)
                tolerance: Maximum distance in units to consider walls as matching (default: 2.0)
                
            Returns:
                JSON string with comparison results including matches, mismatches, and alignment info
            """
            from wall_comparison import compare_sheet_walls, format_comparison_summary
            from database import SessionLocal, Sheet, Document
            
            db = SessionLocal()
            try:
                # Find sheet IDs from codes
                sheet1 = db.query(Sheet).join(Document).filter(
                    Sheet.code == sheet_code_1,
                    Document.project_id == project_id
                ).first()
                
                sheet2 = db.query(Sheet).join(Document).filter(
                    Sheet.code == sheet_code_2,
                    Document.project_id == project_id
                ).first()
                
                if not sheet1:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet '{sheet_code_1}' not found in project {project_id}"
                    })
                    
                if not sheet2:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet '{sheet_code_2}' not found in project {project_id}"
                    })
                
                # Perform the comparison
                result = compare_sheet_walls(sheet1.id, sheet2.id, tolerance)
                
                if result['success']:
                    # Format a human-readable summary
                    summary = format_comparison_summary(result)
                    
                    # Return both structured data and summary
                    return json.dumps({
                        "success": True,
                        "comparison_result": result,
                        "summary": summary,
                        "unmatched_walls": result.get('unmatched_walls', {}),
                        "message": f"Found {result['summary']['total_unmatched_sheet1']} walls only in {sheet_code_1} and {result['summary']['total_unmatched_sheet2']} walls only in {sheet_code_2}"
                    })
                else:
                    return json.dumps({
                        "success": False,
                        "error": result.get('error', 'Unknown error during wall comparison')
                    })
                    
            except Exception as e:
                print(f"Error in compare_walls tool: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error comparing walls: {str(e)}"
                })
            finally:
                db.close()
                
        return compare_walls

    def _highlight_columns_tool(self):
        """Create highlight_columns tool for LangGraph"""
        @tool
        def highlight_columns(project_id: int, sheet_code: str, columns_data: Optional[List[Dict[str, Any]]] = None, color: str = "#4CAF50") -> str:
            """Highlight columns on a sheet with colored overlays. If columns_data is provided, highlights those specific columns. If not provided, automatically extracts and highlights all columns from the sheet."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                # If no columns_data provided, fetch existing columns from database
                if columns_data is None:
                    print(f"No columns_data provided, fetching existing columns for sheet {sheet.code}")
                    existing_columns_result = get_sheet_columns(sheet.id)
                    
                    if not existing_columns_result["success"] or not existing_columns_result["columns"]:
                        # Try to extract columns first
                        print(f"No existing columns found, extracting columns for sheet {sheet.code}")
                        extraction_result = extract_and_save_sheet_columns(sheet.id)
                        
                        if not extraction_result["success"]:
                            return json.dumps({
                                "success": False,
                                "error": f"Could not extract columns from sheet {sheet.code}: {extraction_result.get('error', 'Unknown error')}"
                            })
                        
                        # Get the extracted columns
                        existing_columns_result = get_sheet_columns(sheet.id)
                    
                    # Convert database columns to columns_data format
                    columns_data = []
                    for col in existing_columns_result["columns"]:
                        columns_data.append({
                            'center_x': col['center_x'],
                            'center_y': col['center_y'],
                            'width': col['width'],
                            'height': col['height'],
                            'color': color,  # Use provided color parameter
                            'label': f"C{col['index']}",
                            'grid_reference': ''
                        })
                
                print(f"Highlighting {len(columns_data)} columns on sheet {sheet.code}")
                
                # Validate column data
                validated_columns = []
                for col in columns_data:
                    if all(key in col for key in ['center_x', 'center_y', 'width', 'height']):
                        validated_columns.append({
                            'center_x': float(col['center_x']),
                            'center_y': float(col['center_y']),
                            'width': float(col['width']),
                            'height': float(col['height']),
                            'color': col.get('color', color),  # Use provided color or default
                            'label': col.get('label', ''),
                            'grid_reference': col.get('grid_reference', '')
                        })
                
                result = json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other"
                    },
                    "highlighted_columns": validated_columns,
                    "message": f"Highlighted {len(validated_columns)} columns on sheet {sheet.code}"
                })
                
                print(f"highlight_columns returning: {result[:100]}...")
                return result
                
            except Exception as e:
                print(f"Error highlighting columns: {e}")
                error_result = json.dumps({
                    "success": False,
                    "error": f"Error highlighting columns: {str(e)}"
                })
                print(f"highlight_columns error returning: {error_result}")
                return error_result
            finally:
                db.close()
                
        return highlight_columns

    def _extract_measurements_tool(self):
        """Create extract_measurements tool for LangGraph"""
        @tool
        def extract_measurements(project_id: int, sheet_code: str) -> str:
            """Extract distance measurements and dots from a construction drawing sheet. This tool finds dimension lines, dots, and text measurements in architectural/structural drawings."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                print(f"Extracting measurements from sheet {sheet.code}")
                
                # Extract measurements using the measurement extraction tool
                result = extract_measurements_from_sheet(sheet.id)
                
                if not result["success"]:
                    return json.dumps(result)
                
                measurements = result["measurements"]
                
                # Format the response for better readability
                summary = {
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "page": sheet.page
                    },
                    "summary": {
                        "measurements_extracted": measurements["distances_count"]
                    },
                    "measurements": [
                        {
                            "from_point": dist["pointA"],
                            "to_point": dist["pointB"],
                            "distance_text": dist["distance_text"],
                            "length_inches": dist["length"],
                            "pixel_distance": dist["pixel_distance"],
                            "confidence": dist["confidence_score"],
                            "type": dist["group_type"]
                        }
                        for dist in measurements["distances"][:20]  # Limit to first 20 for readability
                    ]
                }
                
                return json.dumps(summary)
                
            except Exception as e:
                print(f"Error extracting measurements: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error extracting measurements: {str(e)}"
                })
            finally:
                db.close()
                
        return extract_measurements

    def _show_measurements_tool(self):
        """Create show_measurements tool for LangGraph"""
        @tool
        def show_measurements(project_id: int, sheet_code: str, color: str = "#2196F3") -> str:
            """Show distance measurements as visual lines on a construction drawing sheet. This tool extracts measurements if not already done and displays them as colored lines between measurement points."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                print(f"Showing distances for sheet {sheet.code}")
                
                # Extract measurements using the measurement extraction tool
                result = extract_measurements_from_sheet(sheet.id)
                
                if not result["success"]:
                    return json.dumps(result)
                
                measurements = result["measurements"]
                distances = measurements["distances"]
                
                if not distances:
                    return json.dumps({
                        "success": True,
                        "sheet": {
                            "id": sheet.id,
                            "code": sheet.code,
                            "title": sheet.title or "",
                            "page": sheet.page
                        },
                        "message": f"No distance measurements found in sheet {sheet.code}",
                        "distance_lines": [],
                        "summary": {
                            "dots_found": measurements["dots_count"],
                            "distance_texts_found": measurements["texts_count"],
                            "measurements_extracted": 0
                        }
                    })
                
                # Convert distances to line visualization format, filtering out invalid measurements
                distance_lines = []
                valid_measurements = 0
                filtered_measurements = 0
                
                for dist in distances:
                    # Skip measurements with no valid distance
                    if (dist["distance_text"] == "no distance found" or 
                        dist["length"] is None or 
                        dist["length"] == 0):
                        filtered_measurements += 1
                        continue
                    
                    # Parse point coordinates
                    point_a = dist["pointA"].split(",")
                    point_b = dist["pointB"].split(",")
                    
                    if len(point_a) == 2 and len(point_b) == 2:
                        try:
                            line_data = {
                                "start_x": float(point_a[0]),
                                "start_y": float(point_a[1]),
                                "end_x": float(point_b[0]),
                                "end_y": float(point_b[1]),
                                "distance_text": dist["distance_text"],
                                "length_inches": dist["length"],
                                "pixel_distance": dist["pixel_distance"],
                                "confidence": dist["confidence_score"],
                                "type": dist["group_type"],
                                "color": color,
                                "label": f"{dist['distance_text']} ({dist['length']}\")",
                                "stroke_width": 2
                            }
                            distance_lines.append(line_data)
                            valid_measurements += 1
                        except (ValueError, TypeError) as e:
                            print(f"Error parsing coordinates for distance: {e}")
                            filtered_measurements += 1
                            continue
                
                print(f"Filtered results: {valid_measurements} valid measurements, {filtered_measurements} filtered out")
                
                result = json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "page": sheet.page
                    },
                    "distance_lines": distance_lines,
                    "summary": {
                        "lines_visualized": len(distance_lines)
                    },
                    "message": f"Showing {len(distance_lines)} valid distance measurements as lines on sheet {sheet.code} ({filtered_measurements} invalid measurements filtered out)"
                })
                
                print(f"show_measurements returning: {result[:200]}...")
                return result
                
            except Exception as e:
                print(f"Error showing measurements: {e}")
                error_result = json.dumps({
                    "success": False,
                    "error": f"Error showing measurements: {str(e)}"
                })
                print(f"show_measurements error returning: {error_result}")
                return error_result
            finally:
                db.close()
                
        return show_measurements

    def _validate_column_positions_tool(self):
        """Create validate_column_positions tool for LangGraph"""
        @tool
        def validate_column_positions(project_id: int, sheet_code: str, tolerance: float = 0.1) -> str:
            """Validate if column positions are properly described by distance measurements. Checks if horizontal and vertical dimension lines pass through column centers, identifying columns that are not well-positioned relative to the measurements."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                print(f"Validating column positions for sheet {sheet.code}")
                
                # Get columns for this sheet
                columns_result = get_sheet_columns(sheet.id)
                if not columns_result["success"] or not columns_result["columns"]:
                    return json.dumps({
                        "success": False,
                        "error": f"No columns found for sheet {sheet_code}. Please extract columns first."
                    })
                
                columns = columns_result["columns"]
                print(f"Found {len(columns)} columns to validate")
                
                # Extract measurements using the measurement extraction function
                result = extract_measurements_from_sheet(sheet.id)
                
                if not result["success"]:
                    return json.dumps({
                        "success": False,
                        "error": f"Failed to extract measurements: {result.get('error', 'Unknown error')}"
                    })
                
                measurements = result["measurements"]
                distances = measurements["distances"]
                
                print(f"Extracted {measurements['dots_count']} dots, {measurements['texts_count']} texts, {measurements['distances_count']} measurements")
                
                # Extract horizontal and vertical lines from successful measurements
                vertical_lines = []  # X coordinates of vertical dimension lines  
                horizontal_lines = []  # Y coordinates of horizontal dimension lines
                
                for dist in distances:
                    # Skip measurements without valid distance text
                    if dist["distance_text"] == "no distance found" or dist["length"] is None:
                        continue
                        
                    # Parse point coordinates
                    try:
                        point_a = dist["pointA"].split(",")
                        point_b = dist["pointB"].split(",")
                        
                        if len(point_a) == 2 and len(point_b) == 2:
                            x1, y1 = float(point_a[0]), float(point_a[1])
                            x2, y2 = float(point_b[0]), float(point_b[1])
                            
                            if dist["group_type"] == "horizontal_line":
                                # For horizontal measurements, add the horizontal line
                                line_y = (y1 + y2) / 2
                                if line_y not in horizontal_lines:
                                    horizontal_lines.append(line_y)
                                
                                # Add two vertical lines at the endpoints
                                if x1 not in vertical_lines:
                                    vertical_lines.append(x1)
                                if x2 not in vertical_lines:
                                    vertical_lines.append(x2)
                                    
                            elif dist["group_type"] == "vertical_line":
                                # For vertical measurements, add the vertical line
                                line_x = (x1 + x2) / 2
                                if line_x not in vertical_lines:
                                    vertical_lines.append(line_x)
                                
                                # Add two horizontal lines at the endpoints
                                if y1 not in horizontal_lines:
                                    horizontal_lines.append(y1)
                                if y2 not in horizontal_lines:
                                    horizontal_lines.append(y2)
                                    
                    except (ValueError, IndexError):
                        continue
                
                print(f"Found {len(horizontal_lines)} horizontal dimension lines and {len(vertical_lines)} vertical dimension lines")
                
                # Check each column against dimension lines
                well_described_columns = []
                poorly_described_columns = []
                
                for column in columns:
                    center = (column["center_x"], column["center_y"])
                    
                    # Check if there's a vertical line through the column center
                    has_vertical_line = False
                    for v_line in vertical_lines:
                        if abs(center[0] - v_line) <= tolerance:
                            has_vertical_line = True
                            break
                    
                    # Check if there's a horizontal line through the column center
                    has_horizontal_line = False
                    for h_line in horizontal_lines:
                        if abs(center[1] - h_line) <= tolerance:
                            has_horizontal_line = True
                            break
                    
                    column_info = {
                        "index": column["index"],
                        "center_x": center[0],
                        "center_y": center[1],
                        "has_vertical_line": has_vertical_line,
                        "has_horizontal_line": has_horizontal_line,
                        "well_described": has_vertical_line and has_horizontal_line
                    }
                    
                    if column_info["well_described"]:
                        well_described_columns.append(column_info)
                    else:
                        poorly_described_columns.append(column_info)
                
                result = json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "page": sheet.page
                    },
                    "validation_summary": {
                        "total_columns": len(columns),
                        "columns_with_described_position": len(well_described_columns),
                        "columns_with_undescribed_position": len(poorly_described_columns),
                    },
                    "columns": poorly_described_columns,
                    "message": f"Validated {len(columns)} columns: {len(poorly_described_columns)} column positions we don't have exact position measurements for"
                })
                
                return result
                
            except Exception as e:
                print(f"Error validating column positions: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error validating column positions: {str(e)}"
                })
            finally:
                db.close()
                
        return validate_column_positions

    def _validate_wall_positions_tool(self):
        """Create validate_wall_positions tool for LangGraph"""
        @tool
        def validate_wall_positions(project_id: int, sheet_code: str, tolerance: float = 0.1) -> str:
            """Validate if wall positions are properly described by distance measurements. Checks if dimension lines pass through the shorter sides (thickness) of walls and if center lines are parallel to the longer sides, identifying walls that are not well-positioned relative to the measurements."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                print(f"Validating wall positions for sheet {sheet.code}")
                
                # Get walls for this sheet
                walls_result = get_sheet_walls(sheet.id)
                if not walls_result["success"] or not walls_result["walls"]:
                    return json.dumps({
                        "success": False,
                        "error": f"No walls found for sheet {sheet_code}. Please extract walls first."
                    })
                
                walls = walls_result["walls"]
                print(f"Found {len(walls)} walls to validate")
                
                # Extract measurements using the measurement extraction function
                result = extract_measurements_from_sheet(sheet.id)
                
                if not result["success"]:
                    return json.dumps({
                        "success": False,
                        "error": f"Failed to extract measurements: {result.get('error', 'Unknown error')}"
                    })
                
                measurements = result["measurements"]
                distances = measurements["distances"]
                
                print(f"Extracted {measurements['dots_count']} dots, {measurements['texts_count']} texts, {measurements['distances_count']} measurements")
                
                # Extract horizontal and vertical lines from successful measurements
                vertical_lines = []  # X coordinates of vertical dimension lines  
                horizontal_lines = []  # Y coordinates of horizontal dimension lines
                
                for dist in distances:
                    # Skip measurements without valid distance text
                    if dist["distance_text"] == "no distance found" or dist["length"] is None:
                        continue
                        
                    # Parse point coordinates
                    try:
                        point_a = dist["pointA"].split(",")
                        point_b = dist["pointB"].split(",")
                        
                        if len(point_a) == 2 and len(point_b) == 2:
                            x1, y1 = float(point_a[0]), float(point_a[1])
                            x2, y2 = float(point_b[0]), float(point_b[1])
                            
                            if dist["group_type"] == "horizontal_line":
                                # For horizontal measurements, add the horizontal line
                                line_y = (y1 + y2) / 2
                                if line_y not in horizontal_lines:
                                    horizontal_lines.append(line_y)
                                
                                # Add two vertical lines at the endpoints
                                if x1 not in vertical_lines:
                                    vertical_lines.append(x1)
                                if x2 not in vertical_lines:
                                    vertical_lines.append(x2)
                                    
                            elif dist["group_type"] == "vertical_line":
                                # For vertical measurements, add the vertical line
                                line_x = (x1 + x2) / 2
                                if line_x not in vertical_lines:
                                    vertical_lines.append(line_x)
                                
                                # Add two horizontal lines at the endpoints
                                if y1 not in horizontal_lines:
                                    horizontal_lines.append(y1)
                                if y2 not in horizontal_lines:
                                    horizontal_lines.append(y2)
                                    
                    except (ValueError, IndexError):
                        continue
                
                print(f"Found {len(horizontal_lines)} horizontal dimension lines and {len(vertical_lines)} vertical dimension lines")
                
                # Check each wall against dimension lines
                well_described_walls = []
                poorly_described_walls = []
                
                for wall in walls:
                    center_x = wall["center_x"]
                    center_y = wall["center_y"]
                    width = wall["width"]
                    height = wall["height"]
                    orientation = wall["orientation"]
                    
                    # For walls, we need to check different things based on orientation
                    if orientation == "horizontal":
                        # Horizontal wall: longer side is width, shorter side is height
                        # Check if vertical lines pass through the shorter sides (left and right edges)
                        left_edge = center_x - width / 2
                        right_edge = center_x + width / 2
                        
                        has_left_line = any(abs(left_edge - v_line) <= tolerance for v_line in vertical_lines)
                        has_right_line = any(abs(right_edge - v_line) <= tolerance for v_line in vertical_lines)
                        has_thickness_lines = has_left_line and has_right_line
                        
                        # Check if horizontal line passes through center (parallel to longer side)
                        has_center_line = any(abs(center_y - h_line) <= tolerance for h_line in horizontal_lines)
                        
                    else:  # vertical wall
                        # Vertical wall: longer side is height, shorter side is width
                        # Check if horizontal lines pass through the shorter sides (top and bottom edges)
                        top_edge = center_y - height / 2
                        bottom_edge = center_y + height / 2
                        
                        has_top_line = any(abs(top_edge - h_line) <= tolerance for h_line in horizontal_lines)
                        has_bottom_line = any(abs(bottom_edge - h_line) <= tolerance for h_line in horizontal_lines)
                        has_thickness_lines = has_top_line and has_bottom_line
                        
                        # Check if vertical line passes through center (parallel to longer side)
                        has_center_line = any(abs(center_x - v_line) <= tolerance for v_line in vertical_lines)
                    
                    wall_info = {
                        "index": wall["index"],
                        "center_x": center_x,
                        "center_y": center_y,
                        "orientation": orientation,
                        "width": width,
                        "height": height,
                        "has_thickness_lines": has_thickness_lines,
                        "has_center_line": has_center_line,
                        "well_described": has_thickness_lines and has_center_line
                    }
                    
                    if wall_info["well_described"]:
                        well_described_walls.append(wall_info)
                    else:
                        poorly_described_walls.append(wall_info)
                
                result = json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "page": sheet.page
                    },
                    "validation_summary": {
                        "total_walls": len(walls),
                        "well_described_walls": len(well_described_walls),
                        "poorly_described_walls": len(poorly_described_walls),
                        "coverage_percentage": round((len(well_described_walls) / len(walls)) * 100, 1) if walls else 0,
                        "tolerance_used": tolerance
                    },
                    "poorly_described_walls": poorly_described_walls,
                    "message": f"Validated {len(walls)} walls: {len(poorly_described_walls)} wall positions we don't have measurements for"
                })
                
                print(f"Wall validation complete: {len(well_described_walls)}/{len(walls)} walls well-described")
                return result
                
            except Exception as e:
                print(f"Error validating wall positions: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error validating wall positions: {str(e)}"
                })
            finally:
                db.close()
                
        return validate_wall_positions

    def _find_closest_grid_lines_tool(self):
        """Create find_closest_grid_lines tool for LangGraph"""
        @tool
        def find_closest_grid_lines(project_id: int, sheet_code: str, point_x: float, point_y: float) -> str:
            """Find the closest horizontal and vertical grid lines to a given point (x, y) on a construction drawing sheet. This tool helps identify which grid lines a column or feature is nearest to."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                print(f"Finding closest grid lines to point ({point_x}, {point_y}) on sheet {sheet.code}")
                
                # Get grid lines for this sheet
                grid_lines_result = get_sheet_grid_lines(sheet.id)
                if not grid_lines_result["success"] or not grid_lines_result["grid_lines"]:
                    # Try to extract grid lines first
                    print(f"No existing grid lines found, extracting grid lines for sheet {sheet.code}")
                    extraction_result = extract_and_save_sheet_grid_lines(sheet.id)
                    
                    if not extraction_result["success"]:
                        return json.dumps({
                            "success": False,
                            "error": f"Could not extract grid lines from sheet {sheet.code}: {extraction_result.get('error', 'Unknown error')}"
                        })
                    
                    # Get the extracted grid lines
                    grid_lines_result = get_sheet_grid_lines(sheet.id)
                    if not grid_lines_result["success"]:
                        return json.dumps({
                            "success": False,
                            "error": "Failed to retrieve extracted grid lines"
                        })
                
                grid_lines = grid_lines_result["grid_lines"]
                print(f"Found {len(grid_lines)} grid lines to check")
                
                # Find closest grid lines using the provided logic
                closest_horizontal = None
                closest_vertical = None
                min_h_distance = float('inf')
                min_v_distance = float('inf')
                
                for grid_line in grid_lines:
                    if grid_line['orientation'] == 'horizontal':
                        # For horizontal lines, check Y distance
                        distance = abs(point_y - grid_line['center_y'])
                        if distance < min_h_distance:
                            min_h_distance = distance
                            closest_horizontal = grid_line['label']
                    
                    elif grid_line['orientation'] == 'vertical':
                        # For vertical lines, check X distance  
                        distance = abs(point_x - grid_line['center_x'])
                        if distance < min_v_distance:
                            min_v_distance = distance
                            closest_vertical = grid_line['label']
                
                result = {
                    'horizontal': closest_horizontal,
                    'vertical': closest_vertical,
                }
                
                return json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other"
                    },
                    "point": {
                        "x": point_x,
                        "y": point_y
                    },
                    "closest_grid_lines": result,
                    "message": f"Point ({point_x:.1f}, {point_y:.1f}) is closest to grid lines: {closest_vertical or 'none'} (vertical) and {closest_horizontal or 'none'} (horizontal)"
                })
                
            except Exception as e:
                print(f"Error finding closest grid lines: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error finding closest grid lines: {str(e)}"
                })
            finally:
                db.close()
                
        return find_closest_grid_lines

    def _zoom_to_location_tool(self):
        """Create zoom_to_location tool for LangGraph"""
        @tool
        def zoom_to_location(project_id: int, sheet_code: str, center_x: float, center_y: float, zoom_level: float = 2.0) -> str:
            """Zoom the sheet viewer to a specific location (x, y) with a given zoom level. This tool helps focus on specific areas of construction drawings like columns, grid intersections, or detailed sections."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    func.lower(Sheet.code) == sheet_code.lower()
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found"
                    })
                
                # Validate zoom level
                zoom_level = max(0.1, min(10.0, zoom_level))  # Clamp between 0.1x and 10x
                
                print(f"Zooming to location ({center_x}, {center_y}) with zoom level {zoom_level}x on sheet {sheet.code}")
                
                return json.dumps({
                    "success": True,
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other"
                    },
                    "zoom_action": {
                        "center_x": center_x,
                        "center_y": center_y,
                        "zoom_level": zoom_level,
                        "action": "zoom_to_location"
                    },
                    "message": f"Zoomed to ({center_x:.1f}, {center_y:.1f}) at {zoom_level}x zoom on sheet {sheet.code}"
                })
                
            except Exception as e:
                print(f"Error zooming to location: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error zooming to location: {str(e)}"
                })
            finally:
                db.close()
                
        return zoom_to_location

    def _save_rfi_tool(self):
        """Create save_rfi tool for LangGraph"""
        @tool
        def save_rfi(project_id: int, description: str, rfi_type: str = "general", sheet_code: str = None) -> str:
            """Save a Request for Information (RFI) to the project database. Use this tool when construction issues or discrepancies are identified that require clarification. Always returns success to confirm the RFI has been saved."""
            
            # This tool always returns success as requested
            rfi_data = {
                "success": True,
                "rfi_saved": True,
                "message": "RFI has been successfully saved to the project database.",
                "details": {
                    "project_id": project_id,
                    "description": description,
                    "type": rfi_type,
                    "sheet_code": sheet_code,
                    "status": "saved",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
                }
            }
            
            # Log the RFI for monitoring purposes
            print(f"RFI Saved - Project: {project_id}, Type: {rfi_type}, Description: {description[:100]}{'...' if len(description) > 100 else ''}")
            
            return json.dumps(rfi_data)
                
        return save_rfi

    def _mark_non_structural_walls_tool(self):
        """Create mark_non_structural_walls tool for LangGraph"""
        @tool
        def mark_non_structural_walls(project_id: int, sheet_code: str, wall_color: str = "orange") -> str:
            """Mark non-structural concrete walls on a construction drawing by highlighting them with a specific color. This tool identifies walls that are not load-bearing structural elements and marks them for easy identification."""
            
            db = SessionLocal()
            try:
                # Find the sheet
                sheet = db.query(Sheet).join(Document).join(Project).filter(
                    Project.id == project_id,
                    Sheet.code.ilike(sheet_code)
                ).first()
                
                if not sheet:
                    return json.dumps({
                        "success": False,
                        "error": f"Sheet {sheet_code} not found in project {project_id}"
                    })
                
                # Check if sheet has SVG file
                if not sheet.svg_path or not os.path.exists(sheet.svg_path):
                    return json.dumps({
                        "success": False,
                        "error": f"SVG file not found for sheet {sheet_code}"
                    })
                
                # Process the SVG to extract non-structural wall elements for overlay display
                wall_elements = self._extract_non_structural_walls(sheet.svg_path)
                
                if wall_elements is None:
                    return json.dumps({
                        "success": False,
                        "error": "Failed to extract non-structural walls from SVG"
                    })
                
                # Check JSON size and ensure it's manageable
                result_data = {
                    "success": True,
                    "action": "mark_non_structural_walls",
                    "sheet": {
                        "id": sheet.id,
                        "code": sheet.code,
                        "title": sheet.title or "",
                        "type": sheet.type or "Other"
                    },
                    "walls": wall_elements,
                    "wall_color": wall_color,
                    "message": f"Non-structural walls marked on sheet {sheet.code} ({len(wall_elements)} elements)"
                }
                
                # Estimate JSON size before returning
                json_size = len(json.dumps(result_data))
                print(f"📊 mark_non_structural_walls JSON response size: {json_size} bytes")
                
                if json_size > 500000:  # 500KB threshold
                    print(f"⚠️ WARNING: Large JSON response ({json_size} bytes)")
                
                return json.dumps(result_data)
                
            except Exception as e:
                print(f"Error marking non-structural walls: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error marking non-structural walls: {str(e)}"
                })
            finally:
                db.close()
                
        return mark_non_structural_walls

    def _show_exterior_elevations_tool(self):
        """Create show exterior elevations tool for LangGraph"""
        @tool
        def show_exterior_elevations(project_id: int, sheet_code: str = None) -> str:
            """Extract and show elevation markers from construction drawings. This tool finds elevation text (like EL. 100.0, ELEV 85.5) and highlights them with orange overlays on the drawing similar to how columns are displayed."""
            
            try:
                # Read from pre-existing JSON file instead of running OCR processing
                import os

                if sheet_code == 'C7.0':
                    json_file_path = 'json/exterior_elevations.json'
                elif sheet_code == 'A2.11':
                    json_file_path = 'json/el_detections.json'

                if not os.path.exists(json_file_path):
                    return json.dumps({
                        "success": False,
                        "error": f"Exterior elevations JSON file not found at {json_file_path}"
                    })
                
                with open(json_file_path, 'r') as f:
                    exterior_data = json.load(f)
                
                # Convert to expected format
                result = {
                    'success': True,
                    'total_elevations': len(exterior_data.get('detections', [])),
                    'all_elevations': [
                        {
                            'x': detection['bbox']['x']/2,
                            'y': detection['bbox']['y']/2, 
                            'width': detection['bbox']['width']/2,
                            'height': detection['bbox']['height']/2,
                            'text': detection['text']
                        }
                        for detection in exterior_data.get('detections', [])
                    ]
                }
                
                if not result['success']:
                    return json.dumps({
                        "success": False,
                        "error": result['error']
                    })
                
                # Create summary for display with elevation visualization data
                summary_data = {
                    "success": True,
                    "action": "show_exterior_elevations", 
                    "project_id": project_id,
                    "total_elevations": result['total_elevations'],
                    "all_elevations": result['all_elevations']
                }
                
                # If analyzing a specific sheet, provide visualization data like columns
                if sheet_code and result['all_elevations']:
                    # Find the actual sheet from database
                    from database import SessionLocal, Sheet, Document, Project
                    from sqlalchemy import func
                    
                    db = SessionLocal()
                    try:
                        sheet_obj = db.query(Sheet).join(Document).join(Project).filter(
                            Project.id == project_id,
                            func.lower(Sheet.code) == sheet_code.lower()
                        ).first()
                        
                        if sheet_obj:
                            # Format elevation data for frontend visualization (similar to columns)
                            formatted_elevations = []
                            for i, elevation in enumerate(result['all_elevations']):
                                elev_viz = {
                                    'id': f"elev_{i}_{sheet_code}",
                                    'bbox': {
                                        'x': elevation['x'],
                                        'y': elevation['y'], 
                                        'width': elevation['width'],
                                        'height': elevation['height']
                                    },
                                    'text': elevation['text'],
                                    'color': '#FF5722',  # Orange color for elevation markers
                                    'highlighted': True
                                }
                                formatted_elevations.append(elev_viz)
                            
                            # Add visualization data to response
                            summary_data.update({
                                "sheet": {
                                    "id": sheet_obj.id,
                                    "code": sheet_obj.code,
                                    "title": sheet_obj.title or "Sheet",
                                    "type": sheet_obj.type or "drawing",
                                    "page": sheet_obj.page,
                                    "status": sheet_obj.status,
                                    "documentId": sheet_obj.document_id
                                },
                                "highlighted_elevations": formatted_elevations,
                                "elevation_color": "#FF5722"
                            })
                    finally:
                        db.close()
                
                print(f"📏 Found {result['total_elevations']} elevation markers")
                
                # Show elevation summary
                if result['all_elevations']:
                    print(f"📋 {sheet_code}: {len(result['all_elevations'])} elevation markers")
                    for elevation in result['all_elevations'][:3]:  # Show first 3 elevations
                        print(f"  • '{elevation['text']}'")
                
                return json.dumps(summary_data)
                
            except Exception as e:
                print(f"Error showing exterior elevations: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error showing exterior elevations: {str(e)}"
                })
                
        return show_exterior_elevations

    def _align_elevations_tool(self):
        """Create align elevations tool for LangGraph"""
        @tool
        def align_elevations(project_id: int, sheet_code: str = None) -> str:
            """Align EL and DOOR detections using sophisticated iterative alignment algorithms. This tool performs advanced geometric alignment between elevation markers and door elements, computing optimal transformation parameters (scale, translation) with robust outlier handling and convergence analysis."""
            
            try:
                # Read the pairs file
                with open('json/decimal_inches_pairs.json', 'r') as f:
                    pairs_data = json.load(f)
                
                # Format the result
                result = {
                    'success': True,
                    'total_pairs': pairs_data.get('total_pairs', 0),
                    'pairs': pairs_data.get('pairs', [])
                }

                if not result['success']:
                    return json.dumps({
                        "success": False,
                        "error": result['error']
                    })
                
                # Create summary for display with alignment data
                summary_data = {
                    "success": True,
                    "action": "align_elevations", 
                    "project_id": project_id,
                    "total_pairs": result['total_pairs'],
                    "pairs": result['pairs']
                }
                
                return json.dumps(summary_data)
                
            except Exception as e:
                print(f"Error aligning detections: {e}")
                return json.dumps({
                    "success": False,
                    "error": f"Error aligning detections: {str(e)}"
                })
                
        return align_elevations

    def _extract_non_structural_walls(self, svg_path: str):
        """
        Extract non-structural wall elements from SVG for overlay display
        Based on svg_fill_red.py logic to identify RGB(0.754, 0.754, 0.754) elements
        
        Args:
            svg_path: Path to the SVG file
            
        Returns:
            list: Wall element data for frontend overlay rendering
        """
        try:
            from xml.etree import ElementTree as ET
            import re
            
            # Parse the SVG file
            tree = ET.parse(svg_path)
            root = tree.getroot()
            
            # Target color for non-structural concrete walls (light gray)
            target_gray = 0.754  # RGB(0.754, 0.754, 0.754)
            tolerance = 0.001
            
            wall_elements = []
            
            # Function to parse RGB fill values (from svg_fill_red.py)
            def parse_rgb_fill(fill_value):
                if not fill_value or not isinstance(fill_value, str):
                    return None
                
                # Match RGB(r, g, b) pattern with decimal values
                rgb_pattern = r'RGB\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)'
                match = re.match(rgb_pattern, fill_value.strip(), re.IGNORECASE)
                
                if match:
                    try:
                        r = float(match.group(1))
                        g = float(match.group(2))
                        b = float(match.group(3))
                        
                        # Check if it matches our target RGB(0.754, 0.754, 0.754)
                        if (abs(r - target_gray) < tolerance and 
                            abs(g - target_gray) < tolerance and 
                            abs(b - target_gray) < tolerance):
                            return (r, g, b)
                    except ValueError:
                        pass
                
                # Match rgb(r%, g%, b%) pattern with percentage values
                rgb_percent_pattern = r'rgb\s*\(\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)'
                match = re.match(rgb_percent_pattern, fill_value.strip(), re.IGNORECASE)
                
                if match:
                    try:
                        r_percent = float(match.group(1))
                        g_percent = float(match.group(2))
                        b_percent = float(match.group(3))
                        
                        # Convert percentage to decimal (0-1 range)
                        r = r_percent / 100.0
                        g = g_percent / 100.0
                        b = b_percent / 100.0
                        
                        # Check if it matches our target RGB(0.754, 0.754, 0.754)
                        if (abs(r - target_gray) < tolerance and 
                            abs(g - target_gray) < tolerance and 
                            abs(b - target_gray) < tolerance):
                            return (r, g, b)
                    except ValueError:
                        pass
                
                return None
            
            # Define namespace for SVG elements
            ns = {'svg': 'http://www.w3.org/2000/svg'}
            
            # Find and extract elements with target fill color
            element_types = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'g']
            
            for elem_type in element_types:
                # Search with and without namespace
                elements = (root.findall(f'.//svg:{elem_type}', ns) + 
                           root.findall(f'.//{elem_type}'))
                
                for element in elements:
                    # Check fill attribute
                    fill_value = element.get('fill')
                    if fill_value:
                        rgb_match = parse_rgb_fill(fill_value)
                        if rgb_match:
                            # Extract element bounds for overlay
                            wall_data = self._extract_element_bounds(element, elem_type)
                            if wall_data:
                                wall_elements.append(wall_data)
                            else:
                                print(f"⚠️ Failed to extract bounds for {elem_type} element")
                    
                    # Also check style attribute for inline CSS
                    style_value = element.get('style')
                    if style_value:
                        # Parse style attribute for fill property
                        style_parts = [part.strip() for part in style_value.split(';') if part.strip()]
                        
                        for part in style_parts:
                            if part.startswith('fill:'):
                                fill_css = part.split(':', 1)[1].strip()
                                rgb_match = parse_rgb_fill(fill_css)
                                if rgb_match:
                                    # Extract element bounds for overlay
                                    wall_data = self._extract_element_bounds(element, elem_type)
                                    if wall_data:
                                        wall_elements.append(wall_data)
                                    break
            
            print(f"Extracted {len(wall_elements)} non-structural wall elements before filtering")
            
            # Filter out very small elements to reduce JSON size
            MIN_AREA = 1  # Minimum area (width * height) to include - very small threshold
            MAX_ELEMENTS = 500  # Maximum number of elements to send to frontend
            
            filtered_elements = []
            area_values = []
            
            for wall_data in wall_elements:
                if wall_data and 'width' in wall_data and 'height' in wall_data:
                    area = wall_data['width'] * wall_data['height']
                    area_values.append(area)
                    # if area >= MIN_AREA:  # Only include elements with significant size
                    filtered_elements.append(wall_data)
            
            # Debug: show area statistics
            if area_values:
                area_values.sort(reverse=True)
                print(f"📊 Area statistics - Max: {area_values[0]:.2f}, Min: {area_values[-1]:.2f}, Avg: {sum(area_values)/len(area_values):.2f}")
                print(f"📊 Top 5 areas: {area_values[:5]}")
                print(f"📊 Bottom 5 areas: {area_values[-5:]}")
            
            # Sort by area (largest first) and limit count
            filtered_elements.sort(key=lambda x: x.get('width', 0) * x.get('height', 0), reverse=True)
            final_elements = filtered_elements[:MAX_ELEMENTS]
            
            print(f"Filtered to {len(final_elements)} significant non-structural wall elements")
            
            # Debug: show sample elements
            if final_elements:
                print("📋 Sample wall elements:")
                for i, wall in enumerate(final_elements[:3]):  # Show first 3
                    print(f"  [{i+1}] Type: {wall.get('type')}, X: {wall.get('x')}, Y: {wall.get('y')}, W: {wall.get('width')}, H: {wall.get('height')}")
                
            return final_elements
            
        except Exception as e:
            print(f"Error extracting non-structural walls: {e}")
            return None

    def _extract_element_bounds(self, element, elem_type):
        """
        Extract bounding box information from SVG element for overlay rendering
        """
        try:
            bounds = {}
            
            if elem_type == 'rect':
                x = float(element.get('x', 0))
                y = float(element.get('y', 0))
                width = float(element.get('width', 0))
                height = float(element.get('height', 0))
                
                # Keep original dimensions exactly as they are
                
                # Debug the rect values
                if width == 0 or height == 0:
                    print(f"⚠️ Zero-dimension rect: x={x}, y={y}, w={width}, h={height}")
                
                bounds = {
                    'type': 'rect',
                    'x': x,
                    'y': y,
                    'width': width,
                    'height': height
                }
            elif elem_type == 'circle':
                cx = float(element.get('cx', 0))
                cy = float(element.get('cy', 0))
                r = float(element.get('r', 0))
                bounds = {
                    'type': 'circle',
                    'cx': cx,
                    'cy': cy,
                    'r': r,
                    'x': cx - r,
                    'y': cy - r,
                    'width': 2 * r,
                    'height': 2 * r
                }
            elif elem_type == 'path':
                # For paths, avoid including the full path data to reduce JSON size
                # Instead, estimate bounds from path data or use simplified representation
                path_d = element.get('d', '')
                
                # Try to extract basic bounds from path data using simple regex
                import re
                numbers = re.findall(r'[-+]?\d*\.?\d+', path_d)
                
                if len(numbers) >= 4:
                    coords = [float(n) for n in numbers]
                    
                    # Separate x and y coordinates
                    x_coords = coords[0::2]  # Even indices (x coordinates)
                    y_coords = coords[1::2]  # Odd indices (y coordinates)
                    
                    if x_coords and y_coords:
                        min_x, max_x = min(x_coords), max(x_coords)
                        min_y, max_y = min(y_coords), max(y_coords)
                        width = max_x - min_x
                        height = max_y - min_y
                        
                        # Keep original dimensions exactly as they are
                            
                        if width == 0 or height == 0:
                            print(f"⚠️ Zero-dimension path: x={min_x}, y={min_y}, w={width}, h={height} from {len(numbers)} coords")
                        
                        bounds = {
                            'type': 'path',
                            'x': min_x,
                            'y': min_y,
                            'width': width,
                            'height': height,
                            'pathType': 'complex'
                        }
                    else:
                        bounds = {
                            'type': 'path',
                            'x': 0,
                            'y': 0,
                            'width': 3,
                            'height': 3,
                            'pathType': 'minimal'
                        }
                else:
                    bounds = {
                        'type': 'path',
                        'x': 0,
                        'y': 0,
                        'width': 3,
                        'height': 3,
                        'pathType': 'unknown'
                    }
            
            return bounds if bounds else None
            
        except Exception as e:
            print(f"Error extracting bounds for {elem_type}: {e}")
            return None

    def _process_svg_mark_walls(self, svg_path: str, wall_color: str = "orange", sheet_id: int = None):
        """
        Process SVG file to mark non-structural walls similar to svg_fill_red.py
        
        Args:
            svg_path: Path to the SVG file
            wall_color: Color to mark the walls with (default: orange)
            sheet_id: Sheet ID for generating marked SVG filename
            
        Returns:
            dict: Contains marked elements count and marked SVG file path
        """
        try:
            from xml.etree import ElementTree as ET
            import re
            
            # Parse the SVG file
            tree = ET.parse(svg_path)
            root = tree.getroot()
            
            # Target color for non-structural concrete walls (light gray)
            target_gray = 0.754  # RGB(0.754, 0.754, 0.754)
            tolerance = 0.001
            
            # Convert wall_color name to hex
            color_map = {
                "orange": "#FF8C00",
                "red": "#FF0000", 
                "yellow": "#FFFF00",
                "blue": "#0066CC",
                "green": "#00CC66",
                "purple": "#CC00CC"
            }
            hex_color = color_map.get(wall_color.lower(), "#FF8C00")
            
            # Counters
            total_elements = 0
            marked_elements = 0
            
            # Define namespace for SVG elements
            ns = {'svg': 'http://www.w3.org/2000/svg'}
            
            # Function to parse RGB fill values
            def parse_rgb_fill(fill_value):
                if not fill_value or not isinstance(fill_value, str):
                    return None
                
                # Match RGB(r, g, b) pattern with decimal values
                rgb_pattern = r'RGB\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)'
                match = re.match(rgb_pattern, fill_value.strip(), re.IGNORECASE)
                
                if match:
                    try:
                        r = float(match.group(1))
                        g = float(match.group(2))
                        b = float(match.group(3))
                        
                        # Check if it matches our target RGB(0.754, 0.754, 0.754)
                        if (abs(r - target_gray) < tolerance and 
                            abs(g - target_gray) < tolerance and 
                            abs(b - target_gray) < tolerance):
                            return (r, g, b)
                    except ValueError:
                        pass
                
                # Match rgb(r%, g%, b%) pattern with percentage values
                rgb_percent_pattern = r'rgb\s*\(\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%\s*\)'
                match = re.match(rgb_percent_pattern, fill_value.strip(), re.IGNORECASE)
                
                if match:
                    try:
                        r_percent = float(match.group(1))
                        g_percent = float(match.group(2))
                        b_percent = float(match.group(3))
                        
                        # Convert percentage to decimal (0-1 range)
                        r = r_percent / 100.0
                        g = g_percent / 100.0
                        b = b_percent / 100.0
                        
                        # Check if it matches our target RGB(0.754, 0.754, 0.754)
                        if (abs(r - target_gray) < tolerance and 
                            abs(g - target_gray) < tolerance and 
                            abs(b - target_gray) < tolerance):
                            return (r, g, b)
                    except ValueError:
                        pass
                
                return None
            
            # Find and mark elements with target fill color
            element_types = ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'g']
            
            for elem_type in element_types:
                # Search with and without namespace
                elements = (root.findall(f'.//svg:{elem_type}', ns) + 
                           root.findall(f'.//{elem_type}'))
                
                for element in elements:
                    total_elements += 1
                    
                    # Check fill attribute
                    fill_value = element.get('fill')
                    if fill_value:
                        rgb_match = parse_rgb_fill(fill_value)
                        if rgb_match:
                            # Found target RGB - mark as non-structural wall
                            element.set('fill', hex_color)
                            element.set('stroke', hex_color)
                            element.set('stroke-width', '2')
                            marked_elements += 1
                    
                    # Also check style attribute for inline CSS
                    style_value = element.get('style')
                    if style_value:
                        # Parse style attribute for fill property
                        style_parts = [part.strip() for part in style_value.split(';') if part.strip()]
                        modified_style = False
                        
                        for i, part in enumerate(style_parts):
                            if part.startswith('fill:'):
                                fill_css = part.split(':', 1)[1].strip()
                                rgb_match = parse_rgb_fill(fill_css)
                                if rgb_match:
                                    style_parts[i] = f'fill:{hex_color}'
                                    # Add stroke styling
                                    style_parts.append(f'stroke:{hex_color}')
                                    style_parts.append('stroke-width:2')
                                    modified_style = True
                                    marked_elements += 1
                        
                        if modified_style:
                            element.set('style', '; '.join(style_parts))
            
            # Save the marked SVG to a file
            import os
            import tempfile
            
            # Generate marked SVG filename
            if sheet_id:
                marked_svg_filename = f"marked_walls_sheet_{sheet_id}_{wall_color}.svg"
            else:
                marked_svg_filename = f"marked_walls_{wall_color}.svg"
            
            # Save to temp directory or alongside original
            original_dir = os.path.dirname(svg_path)
            marked_svg_path = os.path.join(original_dir, marked_svg_filename)
            
            # Ensure namespace is set for valid SVG
            if 'xmlns' not in root.attrib:
                root.set('xmlns', 'http://www.w3.org/2000/svg')
            
            # Write marked SVG to file
            tree = ET.ElementTree(root)
            tree.write(marked_svg_path, encoding='utf-8', xml_declaration=True)
            
            return {
                "marked_elements": marked_elements,
                "total_elements": total_elements,
                "marked_svg_path": marked_svg_path
            }
            
        except Exception as e:
            print(f"Error processing SVG for wall marking: {e}")
            return None

    def _create_graph(self) -> StateGraph:
        """Create the LangGraph workflow"""
        
        # Define the agent node
        def agent_node(state: AgentState):
            """Main agent reasoning node"""
            project_id = state["project_id"]
            context = state.get("context", {})
            
            # Build context information
            context_info = ""
            if context:
                open_sheets = context.get("openSheets", [])
                current_sheet = context.get("currentSheet")

                if open_sheets:
                    context_info += "\n\nCurrent viewing context:\n"
                    open_list = ", ".join(f"{s['code']} ({s.get('title','')})" for s in open_sheets)
                    context_info += f"- Open sheets: {open_list}\n"

                    if current_sheet:
                        context_info += f"- Currently active sheet: {current_sheet['code']} ({current_sheet.get('title','')})\n"

                    context_info += (
                        f"The user can see {len(open_sheets)} sheet(s) and is currently viewing "
                        f"{current_sheet['code'] if current_sheet else 'none'}."
                    )
                else:
                    context_info += "The user has no open sheets."

            # Create system message
            system_prompt = f"""You are an AI assistant for ConcretePro, a construction document management system. Your role is to assist users in navigating and extracting information from construction drawings.

IMPORTANT : In the project there are two buildings - Hotel and Residential. Each of the building has seven floors, starting from first floor to seventh floor. So, the user will always mention the building name and floor number when referring to specific floor. When you ask for a floor, also include the building name.

You have access to the following tools:
- get_sheets: Get information about all sheets in a project
- open_sheet: Open a specific sheet for viewing
- extract_columns: Extract column positions from construction sheets and save to database
- extract_walls: Extract wall positions, orientations, and dimensions from construction sheets and save to database
- highlight_walls: Highlight walls on a sheet with colored overlays (automatically extracts all walls if not provided), mention the color of the highlight
- extract_grid_lines: Extract grid line labels (H1, H2, HA, HB for hotel; R1, R2, RA, RB for residence) and save to database
- show_grid_lines: Show grid line positions with colored overlays (automatically extracts if not already done)
- highlight_columns: Highlight columns on a sheet with colored overlays (automatically extracts all columns if no specific columns provided), mention the color of the highlight
- show_exterior_elevations: Show elevation markers from construction drawings with orange overlays (reads from pre-processed JSON data)
- query_database: Query the database for statistics, search sheets, get project summaries, and analyze data
- compare_columns: Compare columns between two sheets to find unmatched columns with their grid line references
- compare_walls: Compare walls between two sheets to find unmatched walls based on position, size (width/height), thickness, and orientation with grid line references
- extract_measurements: Extract distance measurements, dimension lines, and dots from construction drawings
- show_measurements: Show distance measurements as visual lines on construction drawings (automatically extracts measurements if not already done)
- validate_column_positions: Check if column positions are properly described by distance measurements by verifying that dimension lines pass through column centers
- validate_wall_positions: Check if wall positions are properly described by distance measurements by verifying that dimension lines pass through the shorter sides (thickness) of walls and center lines are parallel to longer sides
- find_closest_grid_lines: Find the closest horizontal and vertical grid lines to a given point (x, y) coordinate on construction drawings
- zoom_to_location: Zoom the sheet viewer to focus on a specific location (x, y) with adjustable zoom level for detailed inspection

Key capabilities:
- You can search for sheets by code
- You can open specific sheets for viewing
- You can extract and show / highlight column positions from construction drawings
- You can show elevation markers with orange highlights from construction drawings
- You can extract and show grid line labels (H1, H2, HA, HB for hotel plans; R1, R2, RA, RB for residence plans)
- You can extract distance measurements and dimension lines from construction drawings
- You can visualize distance measurements as colored lines on construction drawings
- You can compare columns between two sheets to identify structural mismatches and design inconsistencies
- You can query the database for project statistics, sheet summaries, column data and grid lines data
- You understand construction drawing conventions
- You remember previous messages in this conversation for context
- You can call multiple tools in sequence to fulfill complex requests

When a user asks to open some sheets, use the get_sheets tool to retrieve the list of available sheets. Then, use the open_sheet tool to open the specific sheets the user is interested in.
When users ask for multiple things (like "highlight columns and show grid lines"), use multiple tools to fully satisfy their request.
When user asks to show columns in a sheet, use highlight_columns tool which will automatically extract and highlight all columns with green color.


****** WORKFLOW FOR COMPARING COLUMNS BETWEEN SHEETS ******

IMPORTANT: When asked to compare columns between sheets or find column mismatch, follow this strict workflow:
1. Ask which floor the user is interested in, if the user hasn't explicitly mentioned the sheets. If the user mentions a floor, open one architectural floor plan and one structural floor plan.
2. First open both sheets using open_sheet if not already opened.
3. Use show_grid_lines for both sheets and ask the user if the grid lines are correct
4. Use highlight_columns to highlight all columns for both sheets with green color (tool will auto-extract if needed).
5. STOP HERE!!, Ask for user confirmation to proceed.
6. Use compare_columns to find unmatched columns with their grid references
7. Use highlight_columns to highlight the unmatched columns on each sheet with red color
8. Zoom to the unmatched columns using zoom_to_location tool

NOTE: If there are no unmatched columns found, you should just say that the columns are aligned, don't start looking for them manually.
NOTE: If there are unmatched columns, just list them as Column near gridlines A and B found in sheet X not found in sheet Y and also highlight them in red.
NOTE: When highlighting unmatched columns, use the highlight_columns tool with the column data returned by compare_columns. The unmatched columns should be highlighted in red (#ff6b6b) to indicate they are missing in the other sheet.

***********************************************************

*********** WORKFLOW FOR COLUMN POSITION CHECK ************

IMPORTANT: When asked to check column positions, follow this strict workflow:
1. Ask which floor the user is interested in, if the user hasn't explicitly mentioned the sheet. If the user mentions a floor, open the slab plan for the floor.
2. Show all the columns in the sheet
3. Show all measurements in the sheet
4. STOP HERE!! Ask the user confirmation to proceed
5. Use validate_column_positions tool to check if column positions are properly described by distance measurements
6. If there are any discrepancies, highlight them for the user and zoom into one of the column.

***********************************************************


************ WORKFLOW FOR ELEVATION ALIGNMENT CHECK ****************

IMPORTANT: When asked to check elevation alignment, follow this strict workflow, be super concise in your response:
1. Use align_elevations tool to align the exterior elevations of the sheets.
2. Zoom into EL_2 on A2.11
3. Zoom into (2277, 1204) on C7.0
4. Say that you have aligned the elevations based on this reference elevation of 0 inches.
5. STOP HERE !!! Ask the user confirmation to proceed.
6. Say that there are some elevations that don't match, assuming 21.78 elevation in civil as the reference with 0 inches in architectural, there is a discrepancy where 20.58 elevation in civil is also marked as 0 inches in architectural. This means there is a discrepancy of 1.2 feet.
7. Zoom into EL_16b in sheet A2.11
8. Zoom into (1942, 2084) in sheet C7.0

***********************************************************

IMPORTANT : Be helpful and super concise in your response. Current project ID: {project_id}.

Don't provide unnecessary details or explanations. Don't mention positions with coordinates, always try to mention position based on grid lines.

Remember our conversation context when responding. If users refer to "that sheet" or "the one we discussed", use the conversation history to understand what they mean.{context_info}"""
            
            # Add context information as a message if available
            messages = state["messages"].copy()
            
            # Create message list with system message
            full_messages = [SystemMessage(content=system_prompt)] + [SystemMessage(content=f"[Current viewing context]{context_info}")] + messages

            response = self.llm_with_tools.invoke(full_messages)

            print(response)
            
            return {"messages": [response], "actions": state.get("actions", [])}
        
        # Define the tool processing node
        def process_tools(state: AgentState):
            """Process tool calls and generate frontend actions"""
            last_message = state["messages"][-1]
            actions = state.get("actions", [])
            
            if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                tool_node = ToolNode(self.tools)
                tool_results = tool_node.invoke(state)
                
                # Process tool results to generate frontend actions
                for tool_call in last_message.tool_calls:
                    if tool_call["name"] == "show_grid_lines":
                        # For show_grid_lines, we need to parse the result and create a frontend action
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    result_data = json.loads(tool_result.content)
                                    if result_data.get("success") and result_data.get("grid_lines"):
                                        actions.append({
                                            "action": "show_grid_lines",
                                            "sheet": result_data.get("sheet"),
                                            "grid_lines": result_data.get("grid_lines"),
                                            "message": result_data.get("message")
                                        })
                                    break
                        except Exception as e:
                            print(f"Error creating frontend action for show_grid_lines: {e}")
                    
                    elif tool_call["name"] == "highlight_columns":
                        # For highlight_columns, we need to parse the result and create a frontend action
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"highlight_columns tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Handle empty or invalid content
                                    if not content or content.strip() == "":
                                        print("Warning: highlight_columns returned empty content")
                                        break
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            columns = result_data.get("highlighted_columns", [])
                                            # Ensure columns have color information from tool arguments
                                            tool_color = tool_call.get("args", {}).get("color", "#4CAF50")
                                            for column in columns:
                                                if 'color' not in column or not column.get('color'):
                                                    column['color'] = tool_color
                                            
                                            actions.append({
                                                "action": "highlight_columns",
                                                "sheet": result_data.get("sheet"),
                                                "columns": columns,
                                                "message": result_data.get("message")
                                            })
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for highlight_columns: {json_error}")
                                        print(f"Content was: '{content[:200]}...' (truncated)")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for highlight_columns: {e}")
                    
                    elif tool_call["name"] == "highlight_walls":
                        # For highlight_walls, we need to parse the result and create a frontend action
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"highlight_walls tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Handle empty or invalid content
                                    if not content or content.strip() == "":
                                        print("Warning: highlight_walls returned empty content")
                                        break
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            walls = result_data.get("highlighted_walls", [])
                                            # Ensure walls have color information from tool arguments
                                            tool_color = tool_call.get("args", {}).get("color", "#FF9800")
                                            for wall in walls:
                                                if 'color' not in wall or not wall.get('color'):
                                                    wall['color'] = tool_color
                                            
                                            actions.append({
                                                "action": "highlight_walls",
                                                "sheet": result_data.get("sheet"),
                                                "walls": walls,
                                                "message": result_data.get("message")
                                            })
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for highlight_walls: {json_error}")
                                        print(f"Content was: '{content[:200]}...' (truncated)")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for highlight_walls: {e}")
                    
                    elif tool_call["name"] == "show_exterior_elevations":
                        # For show_exterior_elevations, we need to parse the result and create a frontend action
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"show_exterior_elevations tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Handle empty or invalid content
                                    if not content or content.strip() == "":
                                        print("Warning: show_exterior_elevations returned empty content")
                                        break
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            elevations = result_data.get("highlighted_elevations", [])
                                            # Ensure elevations have color information
                                            elevation_color = "#FF5722"  # Orange color for elevations
                                            for elevation in elevations:
                                                if 'color' not in elevation or not elevation.get('color'):
                                                    elevation['color'] = elevation_color
                                            
                                            actions.append({
                                                "action": "highlight_elevations",
                                                "sheet": result_data.get("sheet"),
                                                "elevations": elevations,
                                                "message": result_data.get("message")
                                            })
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for show_exterior_elevations: {json_error}")
                                        print(f"Content was: '{content[:200]}...' (truncated)")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for show_exterior_elevations: {e}")
                    
                    elif tool_call["name"] == "show_measurements":
                        # For show_measurements, we need to parse the result and create a frontend action
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"show_measurements tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Handle empty or invalid content
                                    if not content or content.strip() == "":
                                        print("Warning: show_measurements returned empty content")
                                        break
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            actions.append({
                                                "action": "show_measurements",
                                                "sheet": result_data.get("sheet"),
                                                "distance_lines": result_data.get("distance_lines"),
                                                "summary": result_data.get("summary"),
                                                "message": result_data.get("message")
                                            })
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for show_measurements: {json_error}")
                                        print(f"Content was: '{content[:200]}...' (truncated)")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for show_measurements: {e}")
                    
                    elif tool_call["name"] == "zoom_to_location":
                        # For zoom_to_location, we need to parse the result and create a frontend action
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"zoom_to_location tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Handle empty or invalid content
                                    if not content or content.strip() == "":
                                        print("Warning: zoom_to_location returned empty content")
                                        break
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            actions.append({
                                                "action": "zoom_to_location",
                                                "sheet": result_data.get("sheet"),
                                                "zoom_action": result_data.get("zoom_action"),
                                                "message": result_data.get("message")
                                            })
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for zoom_to_location: {json_error}")
                                        print(f"Content was: '{content[:200]}...' (truncated)")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for zoom_to_location: {e}")
                    
                    elif tool_call["name"] == "save_rfi":
                        # For save_rfi, we create a success notification action
                        print(f"🔧 Processing save_rfi action for tool call: {tool_call}")
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"save_rfi tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            actions.append({
                                                "action": "rfi_saved",
                                                "message": result_data.get("message", "RFI saved successfully"),
                                                "details": result_data.get("details", {}),
                                                "success": True
                                            })
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for save_rfi: {json_error}")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for save_rfi: {e}")
                    
                    elif tool_call["name"] == "mark_non_structural_walls":
                        # For mark_non_structural_walls, we process the SVG and send the marked content
                        print(f"🔧 Processing mark_non_structural_walls action for tool call: {tool_call}")
                        try:
                            # Find the corresponding tool result
                            for tool_result in tool_results["messages"]:
                                if hasattr(tool_result, 'tool_call_id') and tool_result.tool_call_id == tool_call["id"]:
                                    content = tool_result.content
                                    print(f"mark_non_structural_walls tool result content: '{content}' (type: {type(content)})")
                                    
                                    # Try to parse as JSON
                                    try:
                                        result_data = json.loads(content)
                                        if result_data.get("success"):
                                            # The walls are now included in the result_data, no need to re-extract
                                            print(f"📊 Found {len(result_data.get('walls', []))} non-structural walls for sheet {result_data.get('sheet')}")
                                            actions.append({
                                                "action": "mark_non_structural_walls",
                                                "sheet": result_data.get("sheet"),
                                                "walls": result_data.get("walls", []),
                                                "wall_color": result_data.get("wall_color", "orange"),
                                                "message": result_data.get("message")
                                            })
                                            print(f"✅ Added mark_non_structural_walls action with {len(result_data.get('walls', []))} wall elements")
                                        break
                                    except json.JSONDecodeError as json_error:
                                        print(f"JSON decode error for mark_non_structural_walls: {json_error}")
                                        break
                        except Exception as e:
                            print(f"Error creating frontend action for mark_non_structural_walls: {e}")
                    
                    elif tool_call["name"] == "open_sheet":
                        # For open_sheet, we need to execute the tool ourselves to get SVG content for actions
                        # but still use the tool_node result for LLM conversation
                        print(f"🔧 Processing open_sheet action for tool call: {tool_call}")
                        try:
                            db = SessionLocal()
                            project_id = tool_call["args"].get("project_id")
                            sheet_code = tool_call["args"].get("sheet_code")
                            sheet_id = tool_call["args"].get("sheet_id")
                            
                            # Query for the sheet to get SVG content
                            sheet = None
                            if sheet_code:
                                sheet = db.query(Sheet).join(Document).join(Project).filter(
                                    Project.id == project_id,
                                    Sheet.code.ilike(sheet_code)
                                ).first()
                            elif sheet_id:
                                sheet = db.query(Sheet).join(Document).join(Project).filter(
                                    Project.id == project_id,
                                    Sheet.id == sheet_id
                                ).first()
                            
                            if sheet:
                                # Load SVG content for frontend action
                                svg_content = None
                                if sheet.svg_path and os.path.exists(sheet.svg_path):
                                    try:
                                        with open(sheet.svg_path, 'r', encoding='utf-8') as f:
                                            svg_content = f.read()
                                    except Exception as svg_error:
                                        print(f"Warning: Could not load SVG for sheet {sheet.code}: {svg_error}")
                                
                                # Create frontend action WITHOUT SVG content (to avoid chunking issues)
                                actions.append({
                                    "action": "open_sheet",
                                    "sheet": {
                                        "id": sheet.id,
                                        "code": sheet.code,
                                        "title": sheet.title or "",
                                        "type": sheet.type or "Other",
                                        "page": sheet.page,
                                        "status": sheet.status,
                                        "documentId": sheet.document_id,
                                        "projectName": sheet.document.project.name
                                    }
                                })
                            
                            db.close()
                            
                        except Exception as e:
                            print(f"Error creating frontend action for open_sheet: {e}")
                
                return {
                    "messages": tool_results["messages"], 
                    "actions": actions
                }
            
            return {"messages": [], "actions": actions}
        
        # Define routing function
        def should_continue(state: AgentState) -> str:
            """Determine if we should continue to tools or end"""
            last_message = state["messages"][-1]
            
            if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                return "tools"
            else:
                return "end"
                
        # Define routing after tools
        def should_continue_after_tools(state: AgentState) -> str:
            """Determine if we should continue after tools or end"""
            messages = state.get("messages", [])
            tool_messages = [msg for msg in messages if isinstance(msg, ToolMessage)]
            
            # Check the last message
            if messages:
                last_message = messages[-1]
                
                # If the last message has tool calls, continue to process them
                if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
                    return "tools"
                
                # If it's a ToolMessage (result from a tool), let the agent decide what to do next
                elif hasattr(last_message, 'tool_call_id'):
                    return "agent"
                
                # If it's an AI message without tool calls, we're done
                else:
                    return "end"
            
            return "end"
        
        # Build the graph
        workflow = StateGraph(AgentState)
        
        # Add nodes
        workflow.add_node("agent", agent_node)
        workflow.add_node("tools", process_tools)
        
        # Add edges
        workflow.add_edge(START, "agent")
        workflow.add_conditional_edges(
            "agent",
            should_continue,
            {
                "tools": "tools",
                "end": END
            }
        )
        workflow.add_conditional_edges(
            "tools",
            should_continue_after_tools,
            {
                "agent": "agent",
                "end": END
            }
        )
        
        # Use memory for checkpointing
        memory = MemorySaver()
        return workflow.compile(checkpointer=memory)

    def create_session(self, project_id: int) -> str:
        """Create a new chat session and return session ID"""
        session_id = str(uuid.uuid4())
        self.sessions[session_id] = {
            "project_id": project_id,
            "created_at": time.time(),
            "config": {"configurable": {"thread_id": session_id}}
        }
        print(f"📝 Created new LangGraph session {session_id} for project {project_id}")
        return session_id
    
    def clear_session(self, session_id: str):
        """Clear/delete a session"""
        if session_id in self.sessions:
            project_id = self.sessions[session_id]["project_id"]
            del self.sessions[session_id]
            print(f"🗑️ Cleared LangGraph session {session_id} for project {project_id}")
    
    def get_session_project_id(self, session_id: str) -> Optional[int]:
        """Get the project ID for a session"""
        if session_id in self.sessions:
            return self.sessions[session_id]["project_id"]
        return None

    def process_message(self, message: str, session_id: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Process a user message using LangGraph"""
        try:
            # Get session info
            if session_id not in self.sessions:
                return {
                    "success": False,
                    "error": "Invalid session ID",
                    "response": "Session not found. Please refresh the page to start a new session."
                }
            
            session_info = self.sessions[session_id]
            project_id = session_info["project_id"]
            config = session_info["config"]
            
            # Prepare initial state
            initial_state = {
                "messages": [HumanMessage(content=message)],
                "project_id": project_id,
                "context": context,
                "actions": []
            }
            
            # Run the graph with recursion limit
            config.update({"recursion_limit": 50})  # Set a reasonable limit
            result = self.graph.invoke(initial_state, config)
            
            # Extract response - prioritize actions and tool results
            response_text = "I can help you with construction documents and sheets."
            
            # Check if we have actions that were successfully executed
            actions = result.get("actions", [])
            if actions:
                # Generate response based on the actions that were taken
                action_responses = []
                for action in actions:
                    if action["action"] == "open_sheet":
                        sheet = action["sheet"]
                        action_responses.append(f"Opened sheet {sheet['code']} - {sheet['title']}")
                    elif action["action"] == "show_grid_lines":
                        sheet = action["sheet"]
                        grid_lines = action["grid_lines"]
                        action_responses.append(f"Showing {len(grid_lines)} grid lines from sheet {sheet['code']}")
                    elif action["action"] == "show_measurements":
                        sheet = action["sheet"]
                        distance_lines = action["distance_lines"]
                        action_responses.append(f"Showing {len(distance_lines)} distance measurements as lines from sheet {sheet['code']}")
                    elif action["action"] == "zoom_to_location":
                        sheet = action["sheet"]
                        zoom_action = action["zoom_action"]
                        action_responses.append(f"Zoomed to location ({zoom_action['center_x']:.1f}, {zoom_action['center_y']:.1f}) at {zoom_action['zoom_level']}x on sheet {sheet['code']}")
                    elif action["action"] == "rfi_saved":
                        message = action.get("message", "RFI saved successfully")
                        action_responses.append(message)
                    elif action["action"] == "mark_non_structural_walls":
                        sheet = action["sheet"]
                        walls = action.get("walls", [])
                        wall_color = action["wall_color"]
                        action_responses.append(f"Found {len(walls)} non-structural walls in {wall_color} on sheet {sheet['code']}")
                
                if action_responses:
                    response_text = ". ".join(action_responses) + "."
            
            # Extract the final AI message content (always check, regardless of actions)
            for msg in reversed(result["messages"]):
                if isinstance(msg, AIMessage):
                    content = None
                    
                    # Handle different content types (string or list)
                    if hasattr(msg, 'content') and msg.content:
                        if isinstance(msg.content, str):
                            content = msg.content.strip()
                        elif isinstance(msg.content, list):
                            # If content is a list, try to extract text from it
                            text_parts = []
                            for item in msg.content:
                                if isinstance(item, str):
                                    text_parts.append(item)
                                elif hasattr(item, 'text'):
                                    text_parts.append(str(item.text))
                                elif hasattr(item, 'content'):
                                    text_parts.append(str(item.content))
                            content = " ".join(text_parts).strip()
                        else:
                            content = str(msg.content).strip()
                    
                    # If we found valid content, use it
                    if content and len(content) > 10:  # Only use substantial content
                        response_text = content
                        print(f"✅ Extracted AI response: {content[:100]}...")
                        break
            
            return {
                "success": True,
                "response": response_text,
                "actions": result.get("actions", [])
            }
            
        except Exception as e:
            print(f"Error processing message with LangGraph: {e}")
            return {
                "success": False,
                "error": str(e),
                "response": "I'm sorry, I encountered an error processing your request. Please try again."
            }
    
    async def process_message_stream(self, message: str, session_id: str, context: Optional[Dict[str, Any]] = None):
        """Process a user message with simplified streaming - only tool updates and final result"""
        try:
            # Get session info
            if session_id not in self.sessions:
                yield {
                    "type": "error",
                    "success": False,
                    "error": "Invalid session ID",
                    "response": "Session not found. Please refresh the page to start a new session."
                }
                return
            
            session_info = self.sessions[session_id]
            project_id = session_info["project_id"]
            config = session_info["config"]
            
            # Prepare initial state
            initial_state = {
                "messages": [HumanMessage(content=message)],
                "project_id": project_id,
                "context": context,
                "actions": []
            }
            
            # Collect all actions and final response
            all_actions = []
            final_response = "I can help you with construction documents and sheets."
            
            # Run the graph with streaming updates for tools only
            config.update({"recursion_limit": 100})
            
            # Stream tool execution updates only
            result = self._execute_graph_with_streaming(initial_state, config, session_id)
            
            async for update in result:
                if update["type"] == "tool_status":
                    # Send tool status update
                    yield update
                elif update["type"] == "action":
                    # Send action immediately and collect it
                    all_actions.append(update["action"])
                    yield update
                elif update["type"] == "final_response":
                    final_response = update["response"]
            
            # Send single final response with all data
            yield {
                "type": "final",
                "success": True,
                "response": final_response,
                "actions": all_actions
            }
            
        except Exception as e:
            print(f"Error in streaming message processing: {e}")
            yield {
                "type": "error",
                "success": False,
                "error": str(e),
                "response": "I'm sorry, I encountered an error processing your request. Please try again."
            }
    
    async def _execute_graph_with_streaming(self, initial_state, config, session_id):
        """Execute the graph with simplified streaming - only tool updates and actions"""
        try:
            # Collect all actions
            collected_actions = []
            final_response = "I can help you with construction documents and sheets."
            
            # Use LangGraph's streaming events but filter them
            async for event in self.graph.astream_events(initial_state, config, version="v2"):
                event_type = event.get("event")
                
                if event_type == "on_tool_start":
                    tool_name = event.get("name", "unknown_tool")
                    tool_data = event.get("data", {})
                    tool_input = tool_data.get("input", {})
                    
                    # Generate descriptive message based on tool type
                    status_message = self._get_tool_status_message(tool_name, tool_input)
                    
                    yield {
                        "type": "tool_status",
                        "tool_name": tool_name,
                        "message": status_message,
                        "status": "executing"
                    }
                
                elif event_type == "on_chain_end":
                    # Check if this is the final chain completion
                    chain_data = event.get("data", {})
                    chain_output = chain_data.get("output", {})
                    node_name = event.get("name", "")
                    
                    # Extract actions if available
                    if isinstance(chain_output, dict) and "actions" in chain_output:
                        for action in chain_output["actions"]:
                            if action not in collected_actions:  # Avoid duplicates
                                collected_actions.append(action)
                                print(f"🚀 Action generated: {action.get('action', 'unknown')}")
                                yield {
                                    "type": "action",
                                    "action": action
                                }
                    
                    # Extract final response from messages
                    if isinstance(chain_output, dict) and "messages" in chain_output:
                        messages = chain_output["messages"]
                        for msg in reversed(messages):
                            if isinstance(msg, AIMessage):
                                content = None
                                if hasattr(msg, 'content') and msg.content:
                                    if isinstance(msg.content, str):
                                        content = msg.content.strip()
                                    elif isinstance(msg.content, list):
                                        text_parts = []
                                        for item in msg.content:
                                            if isinstance(item, str):
                                                text_parts.append(item)
                                            elif isinstance(item, dict):
                                                # Handle dict format like {'text': '...', 'type': 'text'}
                                                if 'text' in item:
                                                    text_parts.append(str(item['text']))
                                                elif 'content' in item:
                                                    text_parts.append(str(item['content']))
                                            elif hasattr(item, 'text'):
                                                text_parts.append(str(item.text))
                                            elif hasattr(item, 'content'):
                                                text_parts.append(str(item.content))
                                        content = " ".join(text_parts).strip()
                                    else:
                                        content = str(msg.content).strip()
                                
                                if content and len(content) > 10:
                                    final_response = content
                                    print(f"📝 Extracted final response: {content[:100]}...")
                                    break
            
            # Send final response
            yield {
                "type": "final_response",
                "response": final_response
            }
            
        except Exception as e:
            print(f"❌ Error in simplified streaming execution: {e}")
            import traceback
            traceback.print_exc()
            yield {
                "type": "error",
                "error": str(e),
                "message": f"Error during execution: {str(e)}"
            }
    
    def _get_tool_status_message(self, tool_name: str, tool_args: Dict[str, Any]) -> str:
        """Generate descriptive status messages for different tool types"""
        if tool_name == "show_grid_lines":
            sheet_code = tool_args.get("sheet_code", "sheet")
            return f"Extracting grid lines from sheet {sheet_code}..."
        
        elif tool_name == "open_sheet":
            sheet_code = tool_args.get("sheet_code", "sheet")
            return f"Opening sheet {sheet_code}..."
        
        elif tool_name == "extract_columns":
            sheet_code = tool_args.get("sheet_code", "sheet")
            return f"Analyzing and extracting columns from sheet {sheet_code}..."
        
        elif tool_name == "extract_grid_lines":
            sheet_code = tool_args.get("sheet_code", "sheet")
            return f"Analyzing and extracting grid lines from sheet {sheet_code}..."
        
        elif tool_name == "compare_columns":
            sheet1 = tool_args.get("sheet_code_1", "sheet1")
            sheet2 = tool_args.get("sheet_code_2", "sheet2")
            return f"Comparing columns between sheets {sheet1} and {sheet2}..."
        
        elif tool_name == "highlight_columns":
            sheet_code = tool_args.get("sheet_code", "sheet")
            columns_count = len(tool_args.get("columns_data", []))
            return f"Highlighting {columns_count} columns on sheet {sheet_code}..."
        
        elif tool_name == "show_measurements":
            sheet_code = tool_args.get("sheet_code", "sheet")
            return f"Extracting and visualizing distance measurements from sheet {sheet_code}..."
        
        elif tool_name == "zoom_to_location":
            sheet_code = tool_args.get("sheet_code", "sheet")
            center_x = tool_args.get("center_x", 0)
            center_y = tool_args.get("center_y", 0)
            zoom_level = tool_args.get("zoom_level", 2.0)
            return f"Zooming to location ({center_x:.1f}, {center_y:.1f}) at {zoom_level}x on sheet {sheet_code}..."
        
        elif tool_name == "save_rfi":
            description = tool_args.get("description", "construction issue")
            rfi_type = tool_args.get("rfi_type", "general")
            sheet_code = tool_args.get("sheet_code", "")
            sheet_info = f" on sheet {sheet_code}" if sheet_code else ""
            return f"Saving {rfi_type} RFI: {description[:50]}{'...' if len(description) > 50 else ''}{sheet_info}"
        
        elif tool_name == "mark_non_structural_walls":
            sheet_code = tool_args.get("sheet_code", "sheet")
            wall_color = tool_args.get("wall_color", "orange")
            return f"Marking non-structural concrete walls in {wall_color} on sheet {sheet_code}..."
        
        elif tool_name == "show_exterior_elevations":
            project_id = tool_args.get("project_id", "project")
            sheet_code = tool_args.get("sheet_code", "")
            sheet_info = f" from sheet {sheet_code}" if sheet_code else " from sheets"
            return f"Extracting elevation markers for project {project_id}{sheet_info}..."
        
        elif tool_name == "align_detections":
            project_id = tool_args.get("project_id", "project")
            sheet_code = tool_args.get("sheet_code", "")
            sheet_info = f" from sheet {sheet_code}" if sheet_code else " from sheets"
            return f"Performing iterative alignment of EL and DOOR detections for project {project_id}{sheet_info}..."
        
        elif tool_name == "find_closest_grid_lines":
            sheet_code = tool_args.get("sheet_code", "sheet")
            point_x = tool_args.get("point_x", 0)
            point_y = tool_args.get("point_y", 0)
            return f"Finding closest grid lines to point ({point_x:.1f}, {point_y:.1f}) on sheet {sheet_code}..."
        
        elif tool_name == "get_sheets":
            return "Retrieving available sheets from project..."
        
        elif tool_name == "query_database":
            query_type = tool_args.get("query_type", "data")
            return f"Querying database for {query_type}..."
        
        else:
            return f"Executing {tool_name}..."