from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
import os
import shutil
import subprocess
import json
import threading
import requests
import base64
from datetime import datetime, timedelta
import uuid
from starlette.middleware.sessions import SessionMiddleware
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

from database import get_db, Project, Document, Sheet, Box, Reference, RFI, Check, Distance, SheetColumn, SheetGridLine
from langgraph_agent import LangGraphChatAgent
from columns import extract_and_save_sheet_columns, get_sheet_columns
from grid_lines import extract_and_save_sheet_grid_lines, get_sheet_grid_lines
from toc import process_pdf_toc
from sheet_processor import process_sheet
from multiprocessing_workers import process_single_sheet_worker

# Load environment variables
load_dotenv()

app = FastAPI(title="ConcretePro Backend", version="1.0.0")

# CORS middleware - add more permissive settings for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # Add both localhost and 127.0.0.1
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],  # Explicitly include OPTIONS
    allow_headers=["*"],
    expose_headers=["*"],
)

# Add session middleware for OAuth
app.add_middleware(SessionMiddleware, secret_key="change-in-production-12345")

# Initialize Claude agent
claude_api_key = os.getenv("CLAUDE_API_KEY")
if not claude_api_key:
    raise ValueError("CLAUDE_API_KEY environment variable is required")

claude_agent = LangGraphChatAgent(claude_api_key)

# Pydantic models for request/response
class ChatbotRequest(BaseModel):
    message: str
    sessionId: str
    context: Optional[dict] = None

class SessionCreateRequest(BaseModel):
    projectId: int

class ChatbotResponse(BaseModel):
    success: bool
    response: str
    actions: List[dict] = []
    error: Optional[str] = None

class ProjectResponse(BaseModel):
    id: int
    name: str
    date: str
    documents: int

class SheetResponse(BaseModel):
    id: int
    code: str
    title: str
    type: str
    page: Optional[int]
    status: str
    documentId: int

# Static file serving
app.mount("/documents", StaticFiles(directory="../documents"), name="documents")
app.mount("/rfi-images", StaticFiles(directory="../documents"), name="rfi-images")

# SVG file endpoint with CORS headers
@app.get("/api/svg/{project_name}/{filename}")
async def get_svg_file(project_name: str, filename: str):
    """Serve SVG files with proper CORS headers"""
    try:
        file_path = f"../documents/{project_name}/{filename}"
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="SVG file not found")
        return FileResponse(
            file_path, 
            media_type="image/svg+xml",
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve SVG file: {str(e)}")

# ============================================================================
# API ROUTES
# ============================================================================

@app.get("/")
async def root():
    return {"message": "ConcretePro Python Backend", "version": "1.0.0"}

@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    try:
        # Test database connection
        from sqlalchemy import text
        result = db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": "disconnected", "error": str(e)}

# Chatbot API
@app.post("/api/chatbot/session")
async def create_session(request: SessionCreateRequest):
    """Create a new chatbot session"""
    try:
        if not request.projectId:
            raise HTTPException(status_code=400, detail="Project ID is required")
        
        # Create new session
        session_id = claude_agent.create_session(request.projectId)
        
        return {
            "success": True,
            "sessionId": session_id,
            "message": f"New session created for project {request.projectId}"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/api/chatbot", response_model=ChatbotResponse)
async def chatbot_endpoint(request: ChatbotRequest, db: Session = Depends(get_db)):
    try:
        if not request.message:
            raise HTTPException(status_code=400, detail="Message is required")
        
        if not request.sessionId:
            raise HTTPException(status_code=400, detail="Session ID is required")
        
        print(f"🤖 Processing chatbot message for session {request.sessionId}: {request.message}")
        
        # Process the message with LangGraph Claude agent
        result = claude_agent.process_message(request.message, request.sessionId, request.context)
        
        if result["success"]:
            print(f"✅ Chatbot response generated with {len(result['actions'])} actions")
            return ChatbotResponse(
                success=True,
                response=result["response"],
                actions=result["actions"]
            )
        else:
            print(f"❌ Chatbot processing failed: {result.get('error')}")
            return ChatbotResponse(
                success=False,
                response=result.get("response", "I encountered an error processing your request."),
                error=result.get("error")
            )
    
    except Exception as e:
        print(f"Error in chatbot API: {e}")
        return ChatbotResponse(
            success=False,
            response="I'm sorry, I encountered an unexpected error. Please try again.",
            error=str(e)
        )

@app.post("/api/chatbot/stream")
async def chatbot_stream_endpoint(request: ChatbotRequest, db: Session = Depends(get_db)):
    """Streaming chatbot endpoint that sends real-time updates during tool execution"""
    try:
        if not request.message:
            raise HTTPException(status_code=400, detail="Message is required")
        
        if not request.sessionId:
            raise HTTPException(status_code=400, detail="Session ID is required")
        
        print(f"🤖 Processing streaming chatbot message for session {request.sessionId}: {request.message}")
        
        async def generate_updates():
            # Process the message with streaming updates
            print("🎬 Starting streaming updates generation...")
            async for update in claude_agent.process_message_stream(request.message, request.sessionId, request.context):
                # print(f"📤 Sending streaming update: {update}")
                yield f"data: {json.dumps(update)}\n\n"
            print("🏁 Streaming updates complete")
        
        return StreamingResponse(generate_updates(), media_type="text/plain")
    
    except Exception as e:
        print(f"Error in streaming chatbot API: {e}")
        # Return error as a single update
        async def error_stream():
            error_update = {
                "type": "error",
                "success": False,
                "response": "I'm sorry, I encountered an unexpected error. Please try again.",
                "error": str(e)
            }
            yield f"data: {json.dumps(error_update)}\n\n"
        
        return StreamingResponse(error_stream(), media_type="text/plain")

@app.delete("/api/chatbot/session/{session_id}")
async def clear_session(session_id: str):
    """Clear/delete a chatbot session"""
    try:
        if not session_id:
            raise HTTPException(status_code=400, detail="Session ID is required")
        
        claude_agent.clear_session(session_id)
        
        return {"success": True, "message": f"Session {session_id} cleared"}
    except Exception as e:
        return {"success": False, "error": str(e)}

# Projects API
@app.get("/api/projects")
async def get_projects(db: Session = Depends(get_db)):
    try:
        print("🔍 Attempting to query projects...")
        projects = db.query(Project).all()
        print(f"✅ Found {len(projects)} projects")
        
        result = []
        for project in projects:
            try:
                result.append({
                    "id": project.id,
                    "name": project.name,
                    "date": project.date.strftime("%B %d, %Y"),
                    "documents": len(project.documents)
                })
            except Exception as proj_error:
                print(f"❌ Error processing project {project.id}: {proj_error}")
                
        return result
    except Exception as e:
        print(f"❌ Database error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch projects: {str(e)}")

@app.post("/api/projects")
async def create_project(request: dict, db: Session = Depends(get_db)):
    try:
        name = request.get("name")
        if not name:
            raise HTTPException(status_code=400, detail="Project name is required")
        
        project = Project(name=name)
        db.add(project)
        db.commit()
        db.refresh(project)
        
        return {
            "id": project.id,
            "name": project.name,
            "date": project.date.strftime("%B %d, %Y")
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create project: {str(e)}")

@app.get("/api/projects/{project_id}")
async def get_project(project_id: int, db: Session = Depends(get_db)):
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        total_sheets = db.query(Sheet).join(Document).filter(Document.project_id == project_id).count()
        
        return {
            "id": project.id,
            "name": project.name,
            "date": project.date.strftime("%B %d, %Y"),
            "documents": len(project.documents),
            "sheets": total_sheets
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch project: {str(e)}")

@app.delete("/api/projects")
async def delete_project(id: int, db: Session = Depends(get_db)):
    try:
        if not id:
            raise HTTPException(status_code=400, detail="Project ID is required")
        
        project = db.query(Project).filter(Project.id == id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        db.delete(project)
        db.commit()
        
        return {"message": "Project deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete project: {str(e)}")

# Sheets API
@app.get("/api/sheets")
async def get_sheets(projectId: Optional[int] = None, db: Session = Depends(get_db)):
    try:
        query = db.query(Sheet).join(Document).join(Project)
        
        if projectId:
            query = query.filter(Project.id == projectId)
        
        sheets = query.order_by(Sheet.type, Sheet.code).all()
        
        return {
            "sheets": [
                {
                    "id": sheet.id,
                    "code": sheet.code,
                    "title": sheet.title or "",
                    "type": sheet.type or "Other",
                    "page": sheet.page,
                    "status": sheet.status,
                    "documentId": sheet.document_id,
                    "document": {
                        "project": {
                            "id": sheet.document.project.id,
                            "name": sheet.document.project.name
                        }
                    }
                }
                for sheet in sheets
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sheets: {str(e)}")

@app.get("/api/sheets/{sheet_id}")
async def get_sheet(sheet_id: int, db: Session = Depends(get_db)):
    try:
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        
        sheet_data = {
            "id": sheet.id,
            "code": sheet.code,
            "title": sheet.title,
            "type": sheet.type,
            "page": sheet.page,
            "status": sheet.status,
            "svgPath": sheet.svg_path,
            "documentId": sheet.document_id,
            "document": {
                "project": {
                    "id": sheet.document.project.id,
                    "name": sheet.document.project.name
                }
            }
        }
        
        # Add SVG content if available
        if sheet.svg_path and os.path.exists(sheet.svg_path):
            try:
                with open(sheet.svg_path, 'r', encoding='utf-8') as f:
                    svg_content = f.read()
                    sheet_data["svgContent"] = svg_content
            except Exception as svg_error:
                print(f"Warning: Could not read SVG file: {svg_error}")
        
        return sheet_data
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sheet: {str(e)}")

# Sheet Columns API
@app.post("/api/sheets/{sheet_id}/extract-columns")
async def extract_sheet_columns(sheet_id: int, db: Session = Depends(get_db)):
    """Extract columns from a sheet and save to database"""
    try:
        # Get sheet information
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        
        # Extract and save columns
        result = extract_and_save_sheet_columns(sheet_id)
        
        if result["success"]:
            return {
                "success": True,
                "message": result["message"],
                "columns": result.get("columns", []),
                "sheet_code": result.get("sheet_code")
            }
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Column extraction failed"))
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract columns: {str(e)}")

@app.get("/api/sheets/{sheet_id}/columns")
async def get_sheet_columns_api(sheet_id: int, db: Session = Depends(get_db)):
    """Get existing columns for a sheet from database"""
    try:
        # Check if sheet exists
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        
        # Get columns
        result = get_sheet_columns(sheet_id)
        
        if result["success"]:
            return {
                "success": True,
                "columns": result["columns"],
                "count": result["count"],
                "sheet_code": sheet.code
            }
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to get columns"))
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sheet columns: {str(e)}")

# Sheet Grid Lines API
@app.post("/api/sheets/{sheet_id}/extract-grid-lines")
async def extract_sheet_grid_lines(sheet_id: int, db: Session = Depends(get_db)):
    """Extract grid lines from a sheet and save to database"""
    try:
        # Get sheet information
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        
        # Extract and save grid lines
        result = extract_and_save_sheet_grid_lines(sheet_id)
        
        if result["success"]:
            return {
                "success": True,
                "message": result["message"],
                "grid_lines": result.get("grid_lines", []),
                "sheet_code": result.get("sheet_code")
            }
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Grid line extraction failed"))
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract grid lines: {str(e)}")

@app.get("/api/sheets/{sheet_id}/grid-lines")
async def get_sheet_grid_lines_api(sheet_id: int, db: Session = Depends(get_db)):
    """Get existing grid lines for a sheet from database"""
    try:
        # Check if sheet exists
        sheet = db.query(Sheet).filter(Sheet.id == sheet_id).first()
        if not sheet:
            raise HTTPException(status_code=404, detail="Sheet not found")
        
        # Get grid lines
        result = get_sheet_grid_lines(sheet_id)
        
        if result["success"]:
            return {
                "success": True,
                "grid_lines": result["grid_lines"],
                "count": result["count"],
                "sheet_code": sheet.code
            }
        else:
            raise HTTPException(status_code=500, detail=result.get("error", "Failed to get grid lines"))
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get sheet grid lines: {str(e)}")

# Documents API
@app.get("/api/documents")
async def get_documents(projectId: Optional[int] = None, db: Session = Depends(get_db)):
    try:
        if not projectId:
            raise HTTPException(status_code=400, detail="Project ID is required")
        
        documents = db.query(Document).filter(Document.project_id == projectId).all()
        
        return {
            "documents": [
                {
                    "id": doc.id,
                    "filename": os.path.basename(doc.path),
                    "originalFilename": os.path.basename(doc.path).split('-', 1)[-1] if '-' in os.path.basename(doc.path) else os.path.basename(doc.path),
                    "title": doc.title or os.path.basename(doc.path),
                    "projectId": doc.project_id,
                    "category": doc.category,
                    "subcategory": doc.subcategory
                }
                for doc in documents
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {str(e)}")

@app.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    projectId: str = Form(...),
    type: str = Form(default="pdf"),
    db: Session = Depends(get_db)
):
    try:
        if not file:
            raise HTTPException(status_code=400, detail="No file uploaded")
        
        if not projectId:
            raise HTTPException(status_code=400, detail="Project ID is required")
        
        # Check if file is PDF
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
        # Check if project exists
        project = db.query(Project).filter(Project.id == int(projectId)).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Create documents directory if it doesn't exist
        documents_dir = Path("../documents")
        documents_dir.mkdir(exist_ok=True)
        
        # Generate unique filename with timestamp
        import time
        timestamp = str(int(time.time() * 1000))
        filename = f"{timestamp}-{file.filename}"
        file_path = documents_dir / filename
        
        # Save file to disk
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Save document info to database
        document = Document(
            project_id=int(projectId),
            path=f"documents/{filename}",
            title=file.filename,
            category=type
        )
        db.add(document)
        db.commit()
        db.refresh(document)
        
        # Process TOC to extract sheets
        try:
            toc_success = process_toc_and_save_sheets(str(file_path), document.id, db)
            toc_message = "TOC processed successfully" if toc_success else "TOC processing completed with warnings"
        except Exception as toc_error:
            print(f"Warning: TOC processing failed for document {document.id}: {toc_error}")
            toc_message = f"TOC processing failed: {str(toc_error)}"
        
        return {
            "message": "Document uploaded successfully",
            "toc_status": toc_message,
            "document": {
                "id": document.id,
                "filename": filename,
                "originalFilename": file.filename,
                "projectId": document.project_id,
                "category": document.category,
                "title": document.title
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to upload document: {str(e)}")

@app.get("/api/documents/{filename}")
async def download_document(filename: str):
    try:
        # Security check: ensure filename doesn't contain path traversal
        if ".." in filename or "/" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        file_path = Path("../documents") / filename
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        
        # Remove timestamp prefix for download filename
        original_filename = filename
        if "-" in filename:
            original_filename = filename.split("-", 1)[1]
        
        return FileResponse(
            path=str(file_path),
            filename=original_filename,
            media_type="application/pdf"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve document: {str(e)}")

@app.get("/api/documents/{filename}/view")
async def view_document(filename: str):
    try:
        # Security check: ensure filename doesn't contain path traversal
        if ".." in filename or "/" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        file_path = Path("../documents") / filename
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        
        return FileResponse(
            path=str(file_path),
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve document: {str(e)}")

@app.get("/documents/{filename}.png")
async def serve_png_image(filename: str):
    try:
        # Security check: ensure filename doesn't contain path traversal
        if ".." in filename or "/" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        
        file_path = Path("../documents") / f"{filename}.png"
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Image not found")
        
        return FileResponse(
            path=str(file_path),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=31536000"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve image: {str(e)}")

@app.get("/file/{file_path:path}")
async def serve_absolute_file(file_path: str):
    try:
        # Security check: ensure the file is within allowed directories
        allowed_paths = [
            "/Users/harshvardhanagarwal/Desktop/ConcretePro/documents/",
            str(Path("../documents/").resolve())
        ]
        
        is_allowed = any(file_path.startswith(allowed_path) for allowed_path in allowed_paths)
        
        if not is_allowed:
            raise HTTPException(status_code=403, detail="Access denied")
        
        file_path_obj = Path(file_path)
        if not file_path_obj.exists():
            raise HTTPException(status_code=404, detail="File not found")
        
        # Determine media type based on extension
        media_type = "application/octet-stream"
        if file_path.lower().endswith('.png'):
            media_type = "image/png"
        elif file_path.lower().endswith('.pdf'):
            media_type = "application/pdf"
        elif file_path.lower().endswith('.svg'):
            media_type = "image/svg+xml"
        
        return FileResponse(path=str(file_path_obj), media_type=media_type)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to serve file: {str(e)}")

# RFIs API
@app.get("/api/rfis")
async def get_rfis(projectId: Optional[int] = None, sheetId: Optional[int] = None, type: Optional[str] = None, db: Session = Depends(get_db)):
    try:
        query = db.query(RFI)
        
        if type:
            query = query.filter(RFI.type == type)
        
        if sheetId:
            query = query.join(Check).filter(Check.sheet_code == str(sheetId))
        
        rfis = query.order_by(RFI.created_at.desc()).all()
        
        return {
            "rfis": [
                {
                    "id": rfi.id,
                    "description": rfi.description or "",
                    "type": rfi.type or "",
                    "imagePath": rfi.image_path or "",
                    "createdAt": rfi.created_at.isoformat() if rfi.created_at else "",
                    "checks": [
                        {
                            "id": check.id,
                            "description": check.description or "",
                            "page": check.page or 0,
                            "boundingBox": check.coordinates or "",
                            "rfiId": rfi.id
                        }
                        for check in rfi.checks
                    ]
                }
                for rfi in rfis
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch RFIs: {str(e)}")

@app.post("/api/rfis")
async def create_rfis(request: dict, db: Session = Depends(get_db)):
    try:
        rfis_data = request.get("rfis")
        if not rfis_data or not isinstance(rfis_data, list):
            raise HTTPException(status_code=400, detail="RFIs array is required")
        
        saved_rfis = []
        for rfi_data in rfis_data:
            rfi = RFI(
                description=rfi_data.get("description"),
                type=rfi_data.get("type"),
                image_path=rfi_data.get("imagePath")
            )
            db.add(rfi)
            db.flush()  # Get the ID
            
            # Add checks
            checks_data = rfi_data.get("checks", [])
            for check_data in checks_data:
                check = Check(
                    rfi_id=rfi.id,
                    description=check_data.get("description"),
                    page=check_data.get("page"),
                    sheet_code=check_data.get("sheetCode"),
                    coordinates=check_data.get("coordinates")
                )
                db.add(check)
            
            saved_rfis.append(rfi)
        
        db.commit()
        
        # Refresh and return with checks
        result_rfis = []
        for rfi in saved_rfis:
            db.refresh(rfi)
            result_rfis.append({
                "id": rfi.id,
                "description": rfi.description,
                "type": rfi.type,
                "imagePath": rfi.image_path,
                "createdAt": rfi.created_at.isoformat(),
                "checks": [
                    {
                        "id": check.id,
                        "description": check.description,
                        "page": check.page,
                        "sheetCode": check.sheet_code,
                        "coordinates": check.coordinates
                    }
                    for check in rfi.checks
                ]
            })
        
        return {
            "message": f"Saved {len(result_rfis)} RFIs",
            "rfis": result_rfis
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save RFIs: {str(e)}")

@app.get("/api/rfis/{rfi_id}")
async def get_rfi(rfi_id: int, db: Session = Depends(get_db)):
    try:
        rfi = db.query(RFI).filter(RFI.id == rfi_id).first()
        if not rfi:
            raise HTTPException(status_code=404, detail="RFI not found")
        
        return {
            "id": rfi.id,
            "description": rfi.description or "",
            "type": rfi.type or "",
            "imagePath": rfi.image_path or "",
            "createdAt": rfi.created_at.isoformat() if rfi.created_at else "",
            "checks": [
                {
                    "id": check.id,
                    "description": check.description or "",
                    "page": check.page or 0,
                    "boundingBox": check.coordinates or "",
                    "rfiId": rfi.id
                }
                for check in rfi.checks
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch RFI: {str(e)}")

@app.get("/api/rfis/{rfi_id}/checks")
async def get_rfi_checks(rfi_id: int, db: Session = Depends(get_db)):
    try:
        checks = db.query(Check).filter(Check.rfi_id == rfi_id).order_by(Check.page).all()
        
        return {
            "checks": [
                {
                    "id": check.id,
                    "description": check.description or "",
                    "page": check.page or 0,
                    "boundingBox": check.coordinates or "",
                    "rfiId": check.rfi_id
                }
                for check in checks
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch RFI checks: {str(e)}")

@app.delete("/api/rfis/sheet/{sheet_id}")
async def delete_rfis_by_sheet(sheet_id: int, db: Session = Depends(get_db)):
    try:
        # Find RFIs that have checks for this sheet
        rfis_to_process = db.query(RFI).join(Check).filter(Check.sheet_code == str(sheet_id)).all()
        
        for rfi in rfis_to_process:
            sheet_checks = [c for c in rfi.checks if c.sheet_code == str(sheet_id)]
            other_checks = [c for c in rfi.checks if c.sheet_code != str(sheet_id)]
            
            if len(other_checks) == 0:
                # Delete entire RFI if it only has checks for this sheet
                db.delete(rfi)
            else:
                # Remove only the checks for this sheet
                for check in sheet_checks:
                    db.delete(check)
        
        db.commit()
        return {"message": "RFIs deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete RFIs: {str(e)}")

@app.delete("/api/rfis/{rfi_id}")
async def delete_rfi(rfi_id: int, db: Session = Depends(get_db)):
    try:
        rfi = db.query(RFI).filter(RFI.id == rfi_id).first()
        if not rfi:
            raise HTTPException(status_code=404, detail="RFI not found")
        
        db.delete(rfi)
        db.commit()
        
        return {"message": "RFI deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete RFI: {str(e)}")

@app.patch("/api/rfis/{rfi_id}")
async def update_rfi(rfi_id: int, request: dict, db: Session = Depends(get_db)):
    try:
        description = request.get("description")
        if not description or not isinstance(description, str):
            raise HTTPException(status_code=400, detail="Description must be a string")
        
        rfi = db.query(RFI).filter(RFI.id == rfi_id).first()
        if not rfi:
            raise HTTPException(status_code=404, detail="RFI not found")
        
        rfi.description = description
        db.commit()
        db.refresh(rfi)
        
        return {
            "id": rfi.id,
            "description": rfi.description or "",
            "type": rfi.type or "",
            "imagePath": rfi.image_path or "",
            "createdAt": rfi.created_at.isoformat() if rfi.created_at else "",
            "checks": [
                {
                    "id": check.id,
                    "description": check.description,
                    "page": check.page,
                    "boundingBox": check.coordinates or "",
                    "rfiId": rfi.id
                }
                for check in rfi.checks
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update RFI: {str(e)}")

@app.patch("/api/checks/{check_id}")
async def update_check(check_id: int, request: dict, db: Session = Depends(get_db)):
    try:
        description = request.get("description")
        if not description or not isinstance(description, str):
            raise HTTPException(status_code=400, detail="Description must be a string")
        
        check = db.query(Check).filter(Check.id == check_id).first()
        if not check:
            raise HTTPException(status_code=404, detail="Check not found")
        
        check.description = description
        db.commit()
        db.refresh(check)
        
        return {
            "id": check.id,
            "description": check.description,
            "page": check.page,
            "sheetCode": check.sheet_code,
            "coordinates": check.coordinates
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update check: {str(e)}")

@app.get("/api/page")
async def get_sheet_by_page(page: int, db: Session = Depends(get_db)):
    try:
        if not page:
            raise HTTPException(status_code=400, detail="Page parameter is required")
        
        sheet = db.query(Sheet).filter(Sheet.page == page).first()
        
        if not sheet:
            return {"sheet": None}
        
        # Properly serialize the sheet object
        sheet_data = {
            "id": sheet.id,
            "code": sheet.code,
            "title": sheet.title,
            "type": sheet.type,
            "page": sheet.page,
            "status": sheet.status,
            "svgPath": sheet.svg_path,
            "documentId": sheet.document_id,
            "createdAt": sheet.created_at.isoformat() if sheet.created_at else None,
            "updatedAt": sheet.updated_at.isoformat() if sheet.updated_at else None
        }
        
        return {"sheet": sheet_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sheet: {str(e)}")

# References API
@app.post("/api/references")
async def create_references(request: dict, db: Session = Depends(get_db)):
    try:
        references_data = request.get("references")
        if not references_data or not isinstance(references_data, list):
            raise HTTPException(status_code=400, detail="References array is required")
        
        saved_references = []
        for ref_data in references_data:
            reference = Reference(
                sheet_id=ref_data.get("sheetId"),
                code=ref_data.get("code"),
                sheet_code=ref_data.get("sheetCode"),
                coordinates=ref_data.get("coordinates")
            )
            db.add(reference)
            saved_references.append(reference)
        
        db.commit()
        
        for ref in saved_references:
            db.refresh(ref)
        
        return {
            "message": f"Saved {len(saved_references)} references",
            "references": [
                {
                    "id": ref.id,
                    "sheetId": ref.sheet_id,
                    "code": ref.code,
                    "sheetCode": ref.sheet_code,
                    "coordinates": ref.coordinates
                }
                for ref in saved_references
            ]
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save references: {str(e)}")

@app.delete("/api/references/sheet/{sheet_id}")
async def delete_references_by_sheet(sheet_id: int, db: Session = Depends(get_db)):
    try:
        db.query(Reference).filter(Reference.sheet_id == sheet_id).delete()
        db.commit()
        return {"message": "References deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete references: {str(e)}")

# Boxes API
@app.post("/api/boxes")
async def create_boxes(request: dict, db: Session = Depends(get_db)):
    try:
        boxes_data = request.get("boxes")
        if not boxes_data or not isinstance(boxes_data, list):
            raise HTTPException(status_code=400, detail="Boxes array is required")
        
        saved_boxes = []
        for box_data in boxes_data:
            box = Box(
                sheet_id=box_data.get("sheetId"),
                code=box_data.get("code"),
                title=box_data.get("title"),
                scale=box_data.get("scale"),
                content=box_data.get("content"),
                coordinates=box_data.get("coordinates"),
                type=box_data.get("type", "figure"),
                shape=box_data.get("shape", "rectangle"),
                color=box_data.get("color", "#FF5722"),
                page_width=box_data.get("pageWidth"),
                page_height=box_data.get("pageHeight"),
                user_modified=box_data.get("userModified", False)
            )
            db.add(box)
            saved_boxes.append(box)
        
        db.commit()
        
        for box in saved_boxes:
            db.refresh(box)
        
        return {
            "message": f"Saved {len(saved_boxes)} boxes",
            "boxes": [
                {
                    "id": box.id,
                    "sheetId": box.sheet_id,
                    "code": box.code,
                    "title": box.title,
                    "scale": box.scale,
                    "content": box.content,
                    "coordinates": box.coordinates,
                    "type": box.type,
                    "shape": box.shape,
                    "color": box.color,
                    "pageWidth": box.page_width,
                    "pageHeight": box.page_height,
                    "userModified": box.user_modified
                }
                for box in saved_boxes
            ]
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save boxes: {str(e)}")

@app.delete("/api/boxes/sheet/{sheet_id}")
async def delete_boxes_by_sheet(sheet_id: int, db: Session = Depends(get_db)):
    try:
        db.query(Box).filter(Box.sheet_id == sheet_id).delete()
        db.commit()
        return {"message": "Boxes deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete boxes: {str(e)}")

# Distances API
@app.post("/api/distances")
async def create_distances(request: dict, db: Session = Depends(get_db)):
    try:
        distances_data = request.get("distances")
        if not distances_data or not isinstance(distances_data, list):
            raise HTTPException(status_code=400, detail="Distances array is required")
        
        saved_distances = []
        for dist_data in distances_data:
            distance = Distance(
                sheet_id=dist_data.get("sheetId"),
                point_a=dist_data.get("pointA"),
                point_b=dist_data.get("pointB"),
                length=dist_data.get("length"),
                pixel_distance=dist_data.get("pixel_distance")
            )
            db.add(distance)
            saved_distances.append(distance)
        
        db.commit()
        
        for dist in saved_distances:
            db.refresh(dist)
        
        return {
            "message": f"Saved {len(saved_distances)} distances",
            "distances": [
                {
                    "id": dist.id,
                    "sheetId": dist.sheet_id,
                    "pointA": dist.point_a,
                    "pointB": dist.point_b,
                    "length": dist.length,
                    "pixel_distance": dist.pixel_distance
                }
                for dist in saved_distances
            ]
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save distances: {str(e)}")

@app.delete("/api/distances/sheet/{sheet_id}")
async def delete_distances_by_sheet(sheet_id: int, db: Session = Depends(get_db)):
    try:
        db.query(Distance).filter(Distance.sheet_id == sheet_id).delete()
        db.commit()
        return {"message": "Distances deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete distances: {str(e)}")

# Bounding Boxes API for PDF Viewer
@app.get("/api/sheets/{sheet_id}/bounding-boxes")
async def get_bounding_boxes(sheet_id: int, db: Session = Depends(get_db)):
    try:
        # Get boxes from database
        boxes = db.query(Box).filter(Box.sheet_id == sheet_id).all()
        
        # Transform to PDF viewer format
        bounding_boxes = []
        for box in boxes:
            try:
                coords = box.coordinates.split(',')
                x, y, width, height = [float(coord) for coord in coords]
                
                bounding_boxes.append({
                    "id": str(box.id),
                    "x": x,
                    "y": y,
                    "width": width,
                    "height": height,
                    "code": box.code or '',
                    "title": box.title or '',
                    "content": box.content or '',
                    "type": box.type or 'figure',
                    "shape": box.shape or 'rectangle',
                    "color": box.color or '#FF5722',
                    "pageWidth": box.page_width or 3456,
                    "pageHeight": box.page_height or 2592,
                    "userModified": box.user_modified or False
                })
            except (ValueError, AttributeError) as e:
                print(f"Warning: Could not parse coordinates for box {box.id}: {e}")
                continue
        
        # Return in the format expected by PDF viewer
        response = {
            "document_info": {
                "pdf_name": f"sheet_{sheet_id}.pdf",
                "page_number": 1,
                "svg_dimensions": {"width": 3024, "height": 2160}
            },
            "bounding_boxes": bounding_boxes,
            "metadata": {
                "created_date": datetime.utcnow().isoformat(),
                "modified_date": datetime.utcnow().isoformat(),
                "version": "1.0",
                "total_boxes": len(bounding_boxes),
                "box_types": {
                    "figure": len([b for b in bounding_boxes if b.get("type") == "figure"]),
                    "table": len([b for b in bounding_boxes if b.get("type") == "table"]),
                    "text": len([b for b in bounding_boxes if b.get("type") == "text"])
                }
            }
        }
        
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load bounding boxes: {str(e)}")

@app.put("/api/sheets/{sheet_id}/bounding-boxes")
async def save_bounding_boxes(sheet_id: int, request: dict, db: Session = Depends(get_db)):
    try:
        bounding_boxes = request.get("bounding_boxes", [])
        
        # Delete existing boxes for this sheet
        db.query(Box).filter(Box.sheet_id == sheet_id).delete()
        
        # Transform and save new boxes
        if bounding_boxes:
            box_data = []
            for box in bounding_boxes:
                try:
                    box_record = Box(
                        sheet_id=sheet_id,
                        code=box.get("code", ""),
                        title=box.get("title", ""),
                        content=box.get("content", ""),
                        coordinates=f"{box['x']},{box['y']},{box['width']},{box['height']}",
                        type=box.get("type", "figure"),
                        shape=box.get("shape", "rectangle"),
                        color=box.get("color", "#FF5722"),
                        page_width=box.get("pageWidth", 3456),
                        page_height=box.get("pageHeight", 2592),
                        user_modified=box.get("userModified", False)
                    )
                    db.add(box_record)
                except (KeyError, TypeError) as e:
                    print(f"Warning: Could not save box due to missing/invalid data: {e}")
                    continue
        
        db.commit()
        return {"message": "Bounding boxes saved successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save bounding boxes: {str(e)}")

@app.patch("/api/sheets/{sheet_id}/bounding-boxes/{box_id}")
async def update_bounding_box(sheet_id: int, box_id: int, request: dict, db: Session = Depends(get_db)):
    try:
        # Find the box
        box = db.query(Box).filter(Box.id == box_id, Box.sheet_id == sheet_id).first()
        if not box:
            raise HTTPException(status_code=404, detail="Box not found")
        
        # Update fields that are provided
        if "code" in request:
            box.code = request["code"]
        if "title" in request:
            box.title = request["title"]
        if "content" in request:
            box.content = request["content"]
        if "type" in request:
            box.type = request["type"]
        if "shape" in request:
            box.shape = request["shape"]
        if "color" in request:
            box.color = request["color"]
        if "pageWidth" in request:
            box.page_width = request["pageWidth"]
        if "pageHeight" in request:
            box.page_height = request["pageHeight"]
        if "userModified" in request:
            box.user_modified = request["userModified"]
        
        # Handle coordinate updates
        coords_updated = False
        if any(k in request for k in ["x", "y", "width", "height"]):
            # Get current coordinates
            current_coords = box.coordinates.split(',') if box.coordinates else ['0', '0', '0', '0']
            try:
                current_x, current_y, current_w, current_h = [float(c) for c in current_coords]
                
                new_x = float(request.get("x", current_x))
                new_y = float(request.get("y", current_y))
                new_w = float(request.get("width", current_w))
                new_h = float(request.get("height", current_h))
                
                box.coordinates = f"{new_x},{new_y},{new_w},{new_h}"
                coords_updated = True
            except (ValueError, IndexError) as e:
                print(f"Warning: Could not update coordinates for box {box_id}: {e}")
        
        db.commit()
        db.refresh(box)
        
        # Return updated box in PDF viewer format
        coords = box.coordinates.split(',') if box.coordinates else ['0', '0', '0', '0']
        try:
            x, y, width, height = [float(c) for c in coords]
        except ValueError:
            x, y, width, height = 0, 0, 0, 0
        
        response = {
            "id": str(box.id),
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "code": box.code or "",
            "title": box.title or "",
            "content": box.content or "",
            "type": box.type or "figure",
            "shape": box.shape or "rectangle",
            "color": box.color or "#FF5722",
            "pageWidth": box.page_width or 3456,
            "pageHeight": box.page_height or 2592,
            "userModified": box.user_modified or False
        }
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update bounding box: {str(e)}")

# Background Processing Functions
def process_sheets_background(pdf_path: str, document_id: int, sheet_info: List[dict]):
    """Process sheets in background using multiprocessing for better performance"""
    import time
    
    print(f"🚀 Starting multiprocessing sheet processing for {len(sheet_info)} sheets...")
    start_time = time.time()
    
    # Determine number of workers (use all CPU cores but cap at reasonable number)
    max_workers = min(len(sheet_info), multiprocessing.cpu_count(), 8)  # Cap at 8 to avoid overwhelming the system
    print(f"📊 Using {max_workers} parallel workers for {len(sheet_info)} sheets")
    
    try:
        # Use ProcessPoolExecutor for parallel processing
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            # Submit all sheet processing tasks
            future_to_sheet = {
                executor.submit(process_single_sheet_worker, sheet_data, pdf_path): sheet_data
                for sheet_data in sheet_info
            }
            
            # Collect results as they complete
            completed_count = 0
            failed_count = 0
            
            for future in future_to_sheet:
                sheet_data = future_to_sheet[future]
                try:
                    result = future.result(timeout=300)  # 5 minute timeout per sheet
                    if result["success"]:
                        completed_count += 1
                        print(f"✅ Completed {completed_count}/{len(sheet_info)}: {result['sheet_code']}")
                    else:
                        failed_count += 1
                        print(f"❌ Failed {result['sheet_code']}: {result.get('error', 'Unknown error')}")
                except Exception as e:
                    failed_count += 1
                    print(f"❌ Exception processing {sheet_data.get('code', 'unknown')}: {e}")
        
        end_time = time.time()
        processing_time = end_time - start_time
        
        print(f"🎉 Multiprocessing completed for document {document_id}")
        print(f"📈 Results: {completed_count} successful, {failed_count} failed")
        print(f"⏱️  Total time: {processing_time:.2f} seconds ({processing_time/len(sheet_info):.2f}s per sheet)")
        
    except Exception as e:
        print(f"❌ Multiprocessing failed for document {document_id}: {e}")
        
        # Fallback to sequential processing if multiprocessing fails
        print("🔄 Falling back to sequential processing...")
        try:
            process_sheets_sequential_fallback(pdf_path, sheet_info)
        except Exception as fallback_error:
            print(f"❌ Sequential fallback also failed: {fallback_error}")


def process_sheets_sequential_fallback(pdf_path: str, sheet_info: List[dict]):
    """Fallback sequential processing in case multiprocessing fails"""
    print(f"🔄 Sequential fallback processing {len(sheet_info)} sheets...")
    
    for sheet_data in sheet_info:
        try:
            result = process_single_sheet_worker(sheet_data, pdf_path)
            if result["success"]:
                print(f"✅ Sequential: {result['sheet_code']} completed")
            else:
                print(f"❌ Sequential: {result['sheet_code']} failed")
        except Exception as e:
            print(f"❌ Sequential error: {e}")

def process_toc_and_save_sheets(pdf_path: str, document_id: int, db: Session):
    """Process PDF to extract table of contents and create sheets"""
    try:
        print(f"Starting TOC extraction for document {document_id}")
        
        # Use the imported TOC function directly
        toc_result = process_pdf_toc(pdf_path, document_id)
        print(f"TOC extraction completed for document {document_id}: {toc_result}")
        
        # Save extracted sheets to database
        if toc_result.get("success") and toc_result.get("sheets"):
            created_sheets = []
            sheet_info = []
            for sheet_data in toc_result["sheets"]:
                sheet = Sheet(
                    code=sheet_data.get("code"),
                    title=sheet_data.get("title", ""),
                    type=sheet_data.get("type"),
                    page=sheet_data.get("page"),
                    document_id=document_id,
                    status="not started"  # Initial status
                )
                db.add(sheet)
                db.flush()  # Get the sheet ID
                created_sheets.append(sheet)
                
                # Collect sheet info for background processing (no ORM objects)
                sheet_info.append({
                    "id": sheet.id,
                    "code": sheet.code,
                    "page": sheet.page
                })
            
            db.commit()
            print(f"Saved {len(toc_result['sheets'])} sheets to database for document {document_id}")
            
            # Start background processing for SVG generation
            print(f"Starting background SVG processing for {len(sheet_info)} sheets...")
            background_thread = threading.Thread(
                target=process_sheets_background,
                args=(pdf_path, document_id, sheet_info),
                daemon=True  # Thread will close when main process exits
            )
            background_thread.start()
            print(f"✅ Background processing started for document {document_id}")
            
            return True
        else:
            print(f"No sheets found in TOC extraction result for document {document_id}")
            if not toc_result.get("success"):
                print(f"TOC extraction error: {toc_result.get('error')}")
            return False
            
    except Exception as e:
        print(f"Error in TOC extraction for document {document_id}: {e}")
        return False

# Procore OAuth Integration
# Temporary state storage (in production, use Redis or database)
oauth_states = {}

@app.get("/oauth/procore/callback")
async def procore_oauth_callback(request: Request, code: str = None, error: str = None, state: str = None):
    """Handle OAuth callback - exchange code for token"""
    try:
        if error:
            raise HTTPException(status_code=400, detail=f"OAuth error: {error}")
        
        if not code:
            raise HTTPException(status_code=400, detail="No authorization code received")
        
        # Verify state parameter using temporary storage
        if not state or state not in oauth_states:
            raise HTTPException(status_code=400, detail="Invalid state parameter")
        
        # Remove used state
        del oauth_states[state]
        
        # Exchange code for tokens
        oauth_url = os.getenv("OAUTH_URL", "https://login-sandbox.procore.com")
        redirect_uri = os.getenv("REDIRECT_URI")
        
        token_response = requests.post(f"{oauth_url}/oauth/token", json={
            "grant_type": "authorization_code",
            "client_id": os.getenv("CLIENT_ID"),
            "client_secret": os.getenv("CLIENT_SECRET"),
            "code": code,
            "redirect_uri": redirect_uri
        }, headers={"Content-Type": "application/json"})
        
        if not token_response.ok:
            error_text = token_response.text
            raise HTTPException(status_code=400, detail=f"Token exchange failed: {error_text}")
        
        tokens = token_response.json()
        
        # Store tokens in session (with logging for debugging)
        token_data = {
            "access_token": tokens["access_token"],
            "expires_in": tokens["expires_in"],
            "scope": tokens["scope"]
        }
        request.session["procore_tokens"] = token_data
        print(f"🔐 Stored tokens in session: access_token={tokens['access_token'][:20]}..., scope={tokens['scope']}")
        
        # Redirect back to the frontend Procore page with success
        from fastapi.responses import RedirectResponse
        frontend_url = f"http://localhost:3000/projects/1/procore?auth=success"
        return RedirectResponse(url=frontend_url, status_code=302)
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OAuth callback failed: {str(e)}")

# Procore RFI Integration
@app.post("/api/procore/create-rfi")
async def create_procore_rfi(request: Request, rfi_data: dict):
    """
    Create an RFI in Procore with title, description, and image
    Expected request format:
    {
        "title": "RFI Subject/Title",
        "description": "RFI description/question",
        "image_path": "/path/to/image.png" (optional)
    }
    """
    try:
        # Extract request data
        title = rfi_data.get("title", "").strip()
        description = rfi_data.get("description", "").strip()
        image_path = rfi_data.get("image_path")
        
        print(f"📝 Creating Procore RFI:")
        print(f"   Title: {title}")
        print(f"   Description length: {len(description)} chars")
        print(f"   Image path: {image_path}")
        
        if not title or not description:
            raise HTTPException(status_code=400, detail="Title and description are required")
        
        # Get Procore credentials from environment
        client_id = os.getenv("CLIENT_ID")
        client_secret = os.getenv("CLIENT_SECRET")
        base_url = os.getenv("BASE_URL", "https://sandbox.procore.com")
        oauth_url = os.getenv("OAUTH_URL", "https://login-sandbox.procore.com")
        
        if not client_id or not client_secret:
            raise HTTPException(status_code=500, detail="Procore credentials not configured")
        
        # Hardcoded values for sandbox (same as index.ts)
        project_id = '277792'
        company_id = '4275709'
        
        # Get access token from session (same approach as index.ts)
        procore_tokens = request.session.get("procore_tokens")
        if not procore_tokens or not procore_tokens.get("access_token"):
            raise HTTPException(
                status_code=401, 
                detail="Not authenticated with Procore. Please visit /procore/auth/login first."
            )
        
        access_token = procore_tokens["access_token"]
        
        # Helper function for API calls
        def procore_api_get(endpoint):
            response = requests.get(f"{base_url}{endpoint}", headers={
                "Authorization": f"Bearer {access_token}",
                "Procore-Company-Id": company_id
            })
            if response.ok:
                return response.json()
            return []
        
        # Get potential RFI managers (with fallback)
        try:
            managers = procore_api_get(f"/rest/v1.0/projects/{project_id}/potential_rfi_managers")
        except:
            managers = []
        
        # Get default distribution (with fallback)
        try:
            distribution = procore_api_get(f"/rest/v1.0/projects/{project_id}/rfis/default_distribution")
        except:
            distribution = []
        
        # Handle image upload FIRST if provided
        upload_ids = []
        attachment_info = None
        
        if image_path:
            print(f"🖼️ Pre-uploading image for RFI: {image_path}")
            
            # Handle different image path formats
            if image_path.startswith('../documents/'):
                # Convert relative path to absolute path
                abs_image_path = os.path.join(os.path.dirname(__file__), image_path.replace('documents', 'public'))
            elif image_path.startswith('/'):
                # Already absolute path
                abs_image_path = image_path
            else:
                # Assume it's relative to documents folder
                abs_image_path = os.path.join(os.path.dirname(__file__), '../documents', image_path.lstrip('/'))
            
            print(f"🔍 Resolved image path: {abs_image_path}")
            print(f"📁 Image exists: {os.path.exists(abs_image_path)}")
            
            if os.path.exists(abs_image_path):
                try:
                    # Try uploading to Procore uploads endpoint first
                    file_ext = os.path.splitext(abs_image_path)[1].lower()
                    mime_type = {
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif'
                    }.get(file_ext, 'image/png')
                    
                    # Get file info for Procore upload
                    file_size = os.path.getsize(abs_image_path)
                    filename = os.path.basename(abs_image_path)
                    
                    with open(abs_image_path, 'rb') as img_file:
                        file_content = img_file.read()
                        
                    # Calculate file hash for Procore
                    import hashlib
                    sha256_hash = hashlib.sha256(file_content).hexdigest()
                    md5_hash = hashlib.md5(file_content).hexdigest()
                    
                    # Use Procore's exact multipart form-data format
                    try:
                        import json
                        
                        # Prepare segments data as JSON string
                        segments_data = [{
                            "size": file_size,
                            "sha256": sha256_hash,
                            "md5": md5_hash,
                            "etag": sha256_hash[:40]  # Use first 40 chars of SHA256 as etag
                        }]
                        
                        # Use Procore's JSON upload format (the only one that works)
                        print(f"🔍 Uploading file: {filename} ({file_size} bytes)")
                        
                        json_payload = {
                            'response_filename': filename,
                            'response_content_type': mime_type,
                            'attachment_content_disposition': True,
                            'size': file_size,
                            'segments': segments_data  # Send as actual array
                        }
                        
                        upload_response = requests.post(f"{base_url}/rest/v1.1/projects/{project_id}/uploads",
                            json=json_payload,
                            headers={
                                "Authorization": f"Bearer {access_token}",
                                "Procore-Company-Id": company_id
                            }
                        )
                        
                        print(f"📤 Procore upload response: {upload_response.status_code}")
                        print(f"📤 Request headers: {upload_response.request.headers}")
                        
                        if upload_response.ok:
                            upload_result = upload_response.json()
                            print(f"✅ Upload URL obtained: {upload_result}")
                            
                            # Step 2: Actually upload the file to S3
                            uuid = upload_result.get('uuid')
                            segments = upload_result.get('segments', [])
                            
                            if uuid and segments:
                                segment = segments[0]  # Use first segment
                                s3_url = segment.get('url')
                                s3_headers = segment.get('headers', {})
                                
                                if s3_url:
                                    print(f"📤 Uploading file content to S3: {s3_url[:100]}...")
                                    
                                    # Upload actual file content to S3
                                    s3_response = requests.put(s3_url,
                                        data=file_content,
                                        headers=s3_headers
                                    )
                                    
                                    print(f"📥 S3 upload response: {s3_response.status_code}")
                                    print(f"📥 S3 response headers: {dict(s3_response.headers)}")
                                    
                                    if s3_response.ok or s3_response.status_code == 200:
                                        # Get ETag from S3 response
                                        s3_etag = s3_response.headers.get('ETag', '').strip('"')
                                        print(f"🏷️ S3 ETag: {s3_etag}")
                                        
                                        # Step 3: Finalize the upload with Procore
                                        finalize_payload = {
                                            'segments': [{
                                                'size': file_size,
                                                'sha256': sha256_hash,
                                                'md5': md5_hash,
                                                'etag': s3_etag if s3_etag else sha256_hash[:40]
                                            }]
                                        }
                                        
                                        print(f"📋 Finalizing with payload: {finalize_payload}")
                                        
                                        finalize_response = requests.patch(f"{base_url}/rest/v1.1/projects/{project_id}/uploads/{uuid}",
                                            json=finalize_payload,
                                            headers={
                                                "Authorization": f"Bearer {access_token}",
                                                "Procore-Company-Id": company_id
                                            }
                                        )
                                        
                                        print(f"📋 Finalize response: {finalize_response.status_code}")
                                        
                                        if finalize_response.ok:
                                            upload_ids.append(uuid)
                                            attachment_info = upload_result
                                            print(f"✅ File fully uploaded and finalized with ID: {uuid}")
                                        else:
                                            print(f"⚠️ Finalize failed: {finalize_response.text}")
                                            # Try without finalization - sometimes the file is usable anyway
                                            print("🔄 Trying to use upload without finalization...")
                                            upload_ids.append(uuid)
                                            attachment_info = upload_result
                                            print(f"✅ Using upload ID without finalization: {uuid}")
                                    else:
                                        print(f"❌ S3 upload failed: {s3_response.status_code} {s3_response.text}")
                                else:
                                    print(f"❌ No S3 URL in response: {upload_result}")
                            else:
                                print(f"❌ Missing uuid or segments in response: {upload_result}")
                        else:
                            print(f"❌ Procore upload failed: {upload_response.status_code}")
                            print(f"❌ Response text: {upload_response.text}")
                            print(f"❌ Response headers: {dict(upload_response.headers)}")
                                
                    except Exception as upload_error:
                        print(f"❌ Upload process error: {str(upload_error)}")
                        import traceback
                        traceback.print_exc()
                            
                except Exception as e:
                    print(f"❌ Error pre-uploading image: {str(e)}")
            else:
                print(f"⚠️ Image file not found at: {abs_image_path}")

        # Prepare RFI data in correct Procore format
        due_date = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
        
        rfi_data = {
            "rfi": {
                "subject": title,
                "reference": f"ConcretePro RFI {datetime.now().strftime('%Y%m%d-%H%M%S')}",
                "assignee_ids": [managers[0]["id"]] if managers else [],
                "rfi_manager_id": managers[0]["id"] if managers else None,
                "due_date": due_date,
                "draft": len(managers) == 0,  # Create as draft if no managers
                "private": False,
                "question": {
                    "body": description,
                    "upload_ids": upload_ids
                }
            }
        }
        
        # Create the RFI
        rfi_response = requests.post(f"{base_url}/rest/v1.0/projects/{project_id}/rfis", 
            json=rfi_data,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Procore-Company-Id": company_id,
                "Content-Type": "application/json"
            }
        )
        
        if not rfi_response.ok:
            error_text = rfi_response.text
            raise HTTPException(status_code=500, detail=f"Failed to create RFI in Procore: {error_text}")
        
        created_rfi = rfi_response.json()
        print(f"✅ RFI created successfully: {created_rfi.get('id')} - {created_rfi.get('number')}")
        
        return {
            "success": True,
            "message": "RFI created successfully in Procore",
            "rfi_id": created_rfi.get("id"),
            "rfi_number": created_rfi.get("number"),
            "status": created_rfi.get("status"),
            "procore_url": f"{base_url.replace('sandbox.', 'app.')}/projects/{project_id}/project/rfis/{created_rfi.get('id')}" if not base_url.startswith('https://sandbox') else None,
            "attachment_uploaded": attachment_info is not None,
            "full_response": created_rfi
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error creating Procore RFI: {str(e)}")

# Procore Integration Endpoints
@app.options("/procore/auth/login")
async def procore_login_options():
    """Handle CORS preflight for OAuth login"""
    return {"message": "OK"}

@app.get("/procore/auth/login")
async def procore_login(request: Request):
    """Start Procore OAuth flow"""
    client_id = os.getenv("CLIENT_ID")
    redirect_uri = os.getenv("REDIRECT_URI")
    
    if not client_id or not redirect_uri:
        raise HTTPException(status_code=500, detail="OAuth not configured - missing CLIENT_ID or REDIRECT_URI")
    
    state = str(uuid.uuid4())
    # Store state in temporary storage instead of session
    oauth_states[state] = {
        "created_at": datetime.utcnow().isoformat(),
        "session_id": request.session.get("session_id", "default")
    }
    
    auth_url = f"https://login-sandbox.procore.com/oauth/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&state={state}"
    
    return {"redirect_url": auth_url, "message": "Redirect to this URL for OAuth"}

# Remove /procore/project - not in reference implementation

@app.options("/procore/documents")
async def procore_documents_options():
    """Handle CORS preflight for documents"""
    return {"message": "OK"}

@app.get("/procore/documents")
async def get_procore_documents(request: Request):
    """Get PDF drawings from Procore"""
    try:
        # Check authentication
        tokens = request.session.get("procore_tokens")
        if not tokens or not tokens.get("access_token"):
            raise HTTPException(status_code=401, detail="Not authenticated with Procore")
        
        access_token = tokens["access_token"]
        company_id = 4275709
        project_id = 277792
        
        # Make actual API call to Procore Documents tool
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Procore-Company-Id": str(company_id)
        }
        
        # Use folder path navigation like the reference implementation
        base = "https://sandbox.procore.com"  # Use sandbox URL like reference
        path = "01 Design Files/03 PDF Drawings"
        
        # Walk the folder path (matching reference implementation)
        parts = path.split('/');
        parts = [part.strip() for part in parts if part.strip()]
        
        level_url = f"{base}/rest/v1.0/folders?project_id={project_id}"
        level_response = requests.get(level_url, headers=headers)
        
        if not level_response.ok:
            raise HTTPException(status_code=level_response.status_code, detail=f"Procore API error: {level_response.text}")
        
        level = level_response.json()
        folder = None
        
        for part in parts:
            children = level.get("folders", level)
            next_folder = None
            for child in children or []:
                if child.get("name", "").lower() == part.lower():
                    next_folder = child
                    break
            
            if not next_folder:
                raise HTTPException(status_code=404, detail=f"Folder not found at segment: {part}")
            
            folder = next_folder
            level_url = f"{base}/rest/v1.0/folders/{folder['id']}?project_id={project_id}"
            level_response = requests.get(level_url, headers=headers)
            
            if not level_response.ok:
                raise HTTPException(status_code=level_response.status_code, detail=f"Procore API error: {level_response.text}")
            
            level = level_response.json()
        
        # Get PDF files from the folder
        files = level.get("files", [])
        pdf_files = []
        
        for file in files:
            if file.get("name", "").lower().endswith('.pdf'):
                # Get file metadata like reference implementation
                meta_url = f"{base}/rest/v1.0/files/{file['id']}?project_id={project_id}"
                meta_response = requests.get(meta_url, headers=headers)
                
                if meta_response.ok:
                    meta = meta_response.json()
                    direct_url = (meta.get("download_url") or 
                                meta.get("url") or 
                                (meta.get("file_versions") and meta["file_versions"][0].get("url")))
                    fallback_url = f"{base}/rest/v1.0/local_files/{meta['uuid']}" if meta.get("uuid") else None
                    
                    pdf_files.append({
                        "file_id": str(file.get("id")),
                        "name": file.get("name", "Unknown.pdf"),
                        "size": meta.get("size"),
                        "updated_at": meta.get("updated_at"),
                        "download_url": direct_url or fallback_url
                    })
        
        # Return formatted response
        return {
            "folder_name": "PDF Drawings",
            "path": "Documents",
            "count": len(pdf_files),
            "files": pdf_files
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get documents: {str(e)}")

@app.options("/procore/specifications")
async def procore_specifications_options():
    """Handle CORS preflight for specifications"""
    return {"message": "OK"}

@app.get("/procore/specifications")
async def get_procore_specifications(request: Request):
    """Get specifications from Procore"""
    try:
        # Check authentication
        tokens = request.session.get("procore_tokens")
        if not tokens or not tokens.get("access_token"):
            raise HTTPException(status_code=401, detail="Not authenticated with Procore")
        
        access_token = tokens["access_token"]
        company_id = 4275709
        project_id = 277792
        
        # Make actual API call to Procore Specifications tool
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Procore-Company-Id": str(company_id)
        }
        
        # Use folder path navigation for specifications (matching reference implementation)
        base = "https://sandbox.procore.com"  # Use sandbox URL like reference
        path = "01 Design Files/04 Specifications"
        
        # Walk the folder path (matching reference implementation)
        parts = path.split('/');
        parts = [part.strip() for part in parts if part.strip()]
        
        level_url = f"{base}/rest/v1.0/folders?project_id={project_id}"
        level_response = requests.get(level_url, headers=headers)
        
        if not level_response.ok:
            raise HTTPException(status_code=level_response.status_code, detail=f"Procore API error: {level_response.text}")
        
        level = level_response.json()
        folder = None
        
        for part in parts:
            children = level.get("folders", level)
            next_folder = None
            for child in children or []:
                if child.get("name", "").lower() == part.lower():
                    next_folder = child
                    break
            
            if not next_folder:
                # If specifications folder not found, return empty result instead of error
                return {
                    "folder_name": "Specifications",
                    "path": "Specifications",
                    "count": 0,
                    "files": []
                }
            
            folder = next_folder
            level_url = f"{base}/rest/v1.0/folders/{folder['id']}?project_id={project_id}"
            level_response = requests.get(level_url, headers=headers)
            
            if not level_response.ok:
                return {
                    "folder_name": "Specifications", 
                    "path": "Specifications",
                    "count": 0,
                    "files": []
                }
            
            level = level_response.json()
        
        # Get PDF files from the specifications folder
        files = level.get("files", [])
        spec_files = []
        
        for file in files:
            if file.get("name", "").lower().endswith('.pdf'):
                # Get file metadata like reference implementation
                meta_url = f"{base}/rest/v1.0/files/{file['id']}?project_id={project_id}"
                meta_response = requests.get(meta_url, headers=headers)
                
                if meta_response.ok:
                    meta = meta_response.json()
                    direct_url = (meta.get("download_url") or 
                                meta.get("url") or 
                                (meta.get("file_versions") and meta["file_versions"][0].get("url")))
                    fallback_url = f"{base}/rest/v1.0/local_files/{meta['uuid']}" if meta.get("uuid") else None
                    
                    spec_files.append({
                        "file_id": str(file.get("id")),
                        "name": file.get("name", "Unknown.pdf"),
                        "size": meta.get("size"),
                        "updated_at": meta.get("updated_at"),
                        "download_url": direct_url or fallback_url
                    })
        
        return {
            "folder_name": "Specifications",
            "path": "Specifications",
            "count": len(spec_files),
            "files": spec_files
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get specifications: {str(e)}")

if __name__ == "__main__":
    # Enable multiprocessing support on all platforms
    multiprocessing.set_start_method('spawn', force=True)
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)