from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, ForeignKey, Boolean, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os
from dotenv import load_dotenv

load_dotenv()

# PostgreSQL Database URL
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/concretepro")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Database Models
class Project(Base):
    __tablename__ = "projects"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    documents = relationship("Document", back_populates="project", cascade="all, delete-orphan")

class Document(Base):
    __tablename__ = "documents"
    
    id = Column(Integer, primary_key=True, index=True)
    path = Column(String(500), nullable=False)
    type = Column(String(100))
    title = Column(String(255))
    category = Column(String(100))
    subcategory = Column(String(100))
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    project = relationship("Project", back_populates="documents")
    sheets = relationship("Sheet", back_populates="document", cascade="all, delete-orphan")

class Sheet(Base):
    __tablename__ = "sheets"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), nullable=False)
    title = Column(String(255))
    type = Column(String(100))
    page = Column(Integer)
    status = Column(String(50), default="not started")
    svg_path = Column(String(500))
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    document = relationship("Document", back_populates="sheets")
    boxes = relationship("Box", back_populates="sheet", cascade="all, delete-orphan")
    references = relationship("Reference", back_populates="sheet", cascade="all, delete-orphan")
    distances = relationship("Distance", back_populates="sheet", cascade="all, delete-orphan")
    columns = relationship("SheetColumn", back_populates="sheet", cascade="all, delete-orphan")
    walls = relationship("SheetWall", back_populates="sheet", cascade="all, delete-orphan")
    grid_lines = relationship("SheetGridLine", back_populates="sheet", cascade="all, delete-orphan")

class Box(Base):
    __tablename__ = "boxes"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(100))
    title = Column(String(255))
    content = Column(Text)
    coordinates = Column(String(255))
    type = Column(String(50), default="figure")
    shape = Column(String(50), default="rectangle")
    color = Column(String(20), default="#FF5722")
    page_width = Column(Integer)
    page_height = Column(Integer)
    user_modified = Column(Boolean, default=False)
    sheet_id = Column(Integer, ForeignKey("sheets.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sheet = relationship("Sheet", back_populates="boxes")

class Reference(Base):
    __tablename__ = "references"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(100))
    sheet_code = Column(String(50))
    coordinates = Column(String(255))
    sheet_id = Column(Integer, ForeignKey("sheets.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sheet = relationship("Sheet", back_populates="references")

class RFI(Base):
    __tablename__ = "rfis"
    
    id = Column(Integer, primary_key=True, index=True)
    description = Column(Text)
    type = Column(String(100))
    image_path = Column(String(500))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    checks = relationship("Check", back_populates="rfi", cascade="all, delete-orphan")

class Check(Base):
    __tablename__ = "checks"
    
    id = Column(Integer, primary_key=True, index=True)
    description = Column(Text)
    page = Column(Integer)
    sheet_code = Column(String(50))
    coordinates = Column(String(255))
    rfi_id = Column(Integer, ForeignKey("rfis.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    rfi = relationship("RFI", back_populates="checks")

class Distance(Base):
    __tablename__ = "distances"
    
    id = Column(Integer, primary_key=True, index=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id"), nullable=False)
    point_a = Column(String(255))
    point_b = Column(String(255))
    length = Column(Float)
    pixel_distance = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sheet = relationship("Sheet", back_populates="distances")

class SheetColumn(Base):
    __tablename__ = "sheet_columns"
    
    id = Column(Integer, primary_key=True, index=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id"), nullable=False)
    column_index = Column(Integer, nullable=False)  # 0-based index
    center_x = Column(Float, nullable=False)
    center_y = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sheet = relationship("Sheet", back_populates="columns")

class SheetWall(Base):
    __tablename__ = "sheet_walls"
    
    id = Column(Integer, primary_key=True, index=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id"), nullable=False)
    index = Column(Integer, nullable=False)  # Wall index/number
    center_x = Column(Float, nullable=False)
    center_y = Column(Float, nullable=False)
    width = Column(Float, nullable=False)
    height = Column(Float, nullable=False)
    orientation = Column(String(20), nullable=False)  # 'horizontal' or 'vertical'
    thickness = Column(Float, nullable=False)  # Shorter dimension (wall thickness)
    length = Column(Float, nullable=False)  # Longer dimension (wall length)
    aspect_ratio = Column(Float)  # Length/thickness ratio
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sheet = relationship("Sheet", back_populates="walls")

class SheetGridLine(Base):
    __tablename__ = "sheet_grid_lines"
    
    id = Column(Integer, primary_key=True, index=True)
    sheet_id = Column(Integer, ForeignKey("sheets.id"), nullable=False)
    label = Column(String(50), nullable=False)  # H1, H2, HA, HB, R1, RA, etc.
    category = Column(String(50), nullable=False)  # 'hotel', 'residence', etc.
    orientation = Column(String(20), nullable=False)  # 'vertical' or 'horizontal'
    center_x = Column(Float, nullable=False)
    center_y = Column(Float, nullable=False)
    bbox_width = Column(Float, nullable=False)
    bbox_height = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    sheet = relationship("Sheet", back_populates="grid_lines")

# Dependency to get database session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()