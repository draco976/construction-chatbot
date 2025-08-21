#!/usr/bin/env python3
"""
Database setup script for ConcretePro PostgreSQL migration
"""
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from database import Base, engine
from dotenv import load_dotenv
import os

load_dotenv()

def create_database():
    """Create the PostgreSQL database if it doesn't exist"""
    try:
        # Parse DATABASE_URL to get connection details
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            print("❌ DATABASE_URL not found in environment variables")
            return False
            
        # Extract connection details from URL
        # Format: postgresql://user:password@host:port/database
        url_parts = db_url.replace("postgresql://", "").split("/")
        db_name = url_parts[1]
        host_part = url_parts[0].split("@")
        host_info = host_part[1].split(":")
        host = host_info[0]
        port = int(host_info[1])
        
        user_pass = host_part[0].split(":")
        user = user_pass[0]
        password = user_pass[1]
        
        print(f"🔧 Connecting to PostgreSQL server at {host}:{port}")
        
        # Connect to PostgreSQL server (not specific database)
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database="postgres"  # Connect to default postgres database
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Check if database exists
        cursor.execute("SELECT 1 FROM pg_catalog.pg_database WHERE datname = %s", (db_name,))
        exists = cursor.fetchone()
        
        if not exists:
            print(f"📦 Creating database '{db_name}'...")
            cursor.execute(f'CREATE DATABASE "{db_name}"')
            print(f"✅ Database '{db_name}' created successfully")
        else:
            print(f"ℹ️ Database '{db_name}' already exists")
        
        cursor.close()
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Error creating database: {e}")
        return False

def create_tables():
    """Create all tables using SQLAlchemy"""
    try:
        print("📋 Creating database tables...")
        Base.metadata.create_all(bind=engine)
        print("✅ All tables created successfully")
        return True
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        return False

def main():
    """Main setup function"""
    print("🚀 Setting up ConcretePro PostgreSQL database...")
    
    # Step 1: Create database
    if not create_database():
        print("❌ Failed to create database. Please check your PostgreSQL connection.")
        return
    
    # Step 2: Create tables
    if not create_tables():
        print("❌ Failed to create tables.")
        return
    
    print("🎉 Database setup completed successfully!")
    print("\n📝 Next steps:")
    print("1. Install dependencies: pip install -r requirements.txt")
    print("2. Start the server: uvicorn main:app --reload")
    print("3. Access the API at: http://localhost:8080")

if __name__ == "__main__":
    main()