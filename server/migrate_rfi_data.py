#!/usr/bin/env python3
"""
Migration script to transfer RFI and Check data from Prisma SQLite database to PostgreSQL.
"""

import sqlite3
import psycopg2
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
import os

load_dotenv()

# Database connections
SQLITE_DB_PATH = "/Users/harshvardhanagarwal/Desktop/ConcretePro/prisma/dev.db"
POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/concretepro")

def connect_databases():
    """Connect to both SQLite and PostgreSQL databases."""
    # Connect to SQLite
    sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)
    sqlite_conn.row_factory = sqlite3.Row  # Enable column access by name
    
    # Connect to PostgreSQL
    postgres_conn = psycopg2.connect(POSTGRES_URL)
    
    return sqlite_conn, postgres_conn

def migrate_rfis(sqlite_cursor, postgres_cursor):
    """Migrate RFI data from SQLite to PostgreSQL."""
    print("Migrating RFI records...")
    
    # Fetch all RFI records from SQLite
    sqlite_cursor.execute("""
        SELECT id, title, description, type, imagePath, createdAt
        FROM Rfi
        ORDER BY id
    """)
    
    rfis = sqlite_cursor.fetchall()
    print(f"Found {len(rfis)} RFI records in SQLite")
    
    # Check if RFIs already exist in PostgreSQL
    postgres_cursor.execute("SELECT COUNT(*) FROM rfis")
    existing_count = postgres_cursor.fetchone()[0]
    
    if existing_count > 0:
        print(f"Found {existing_count} existing RFI records in PostgreSQL")
        response = input("Do you want to clear existing data and re-import? (y/N): ")
        if response.lower() == 'y':
            postgres_cursor.execute("DELETE FROM checks")
            postgres_cursor.execute("DELETE FROM rfis")
            print("Cleared existing RFI and Check data from PostgreSQL")
        else:
            print("Skipping RFI migration")
            return 0
    
    # Insert RFI records into PostgreSQL
    migrated_count = 0
    for rfi in rfis:
        try:
            # Map SQLite columns to PostgreSQL columns
            # SQLite: id, title, description, type, imagePath, createdAt
            # PostgreSQL: id, description (combines title + description), type, image_path, created_at
            
            # Combine title and description for PostgreSQL description field
            combined_description = f"{rfi['title']}\n\n{rfi['description']}" if rfi['title'] and rfi['description'] else (rfi['description'] or rfi['title'] or '')
            
            postgres_cursor.execute("""
                INSERT INTO rfis (id, description, type, image_path, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                rfi['id'],
                combined_description,
                rfi['type'],
                rfi['imagePath'],  # SQLite camelCase -> PostgreSQL snake_case
                rfi['createdAt'],
                rfi['createdAt']  # Use createdAt for both created_at and updated_at
            ))
            migrated_count += 1
        except Exception as e:
            print(f"Error migrating RFI {rfi['id']}: {e}")
    
    print(f"Successfully migrated {migrated_count} RFI records")
    return migrated_count

def migrate_checks(sqlite_cursor, postgres_cursor):
    """Migrate Check data from SQLite to PostgreSQL."""
    print("Migrating Check records...")
    
    # First, get all valid RFI IDs from PostgreSQL
    postgres_cursor.execute("SELECT id FROM rfis")
    valid_rfi_ids = set(row[0] for row in postgres_cursor.fetchall())
    print(f"Found {len(valid_rfi_ids)} valid RFI IDs in PostgreSQL")
    
    # Fetch all Check records from SQLite
    sqlite_cursor.execute("""
        SELECT id, page, boundingBox, description, rfiId
        FROM `Check`
        ORDER BY id
    """)
    
    checks = sqlite_cursor.fetchall()
    print(f"Found {len(checks)} Check records in SQLite")
    
    # Filter out orphaned checks
    valid_checks = []
    orphaned_checks = []
    for check in checks:
        if check['rfiId'] in valid_rfi_ids:
            valid_checks.append(check)
        else:
            orphaned_checks.append(check)
    
    print(f"Found {len(orphaned_checks)} orphaned check records (will be skipped)")
    print(f"Migrating {len(valid_checks)} valid check records")
    
    # Insert Check records into PostgreSQL
    migrated_count = 0
    skipped_count = 0
    
    for check in valid_checks:
        try:
            # Get sheet_code for this page (if available)
            sheet_code = None
            postgres_cursor.execute("SELECT code FROM sheets WHERE page = %s LIMIT 1", (check['page'],))
            sheet_result = postgres_cursor.fetchone()
            if sheet_result:
                sheet_code = sheet_result[0]
            
            postgres_cursor.execute("""
                INSERT INTO checks (id, description, page, sheet_code, coordinates, rfi_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                check['id'],
                check['description'],
                check['page'],
                sheet_code,
                check['boundingBox'],  # Store JSON as string
                check['rfiId'],  # SQLite camelCase -> PostgreSQL snake_case foreign key
                datetime.now(timezone.utc),  # Use timezone-aware datetime
                datetime.now(timezone.utc)
            ))
            migrated_count += 1
        except Exception as e:
            print(f"Error migrating Check {check['id']}: {e}")
            skipped_count += 1
    
    print(f"Successfully migrated {migrated_count} Check records")
    print(f"Skipped {skipped_count} Check records due to errors")
    return migrated_count

def update_sequences(postgres_cursor):
    """Update PostgreSQL sequences to continue from the highest migrated IDs."""
    print("Updating PostgreSQL sequences...")
    
    # Update RFI sequence
    postgres_cursor.execute("SELECT MAX(id) FROM rfis")
    max_rfi_id = postgres_cursor.fetchone()[0]
    if max_rfi_id:
        postgres_cursor.execute(f"SELECT setval('rfis_id_seq', {max_rfi_id})")
        print(f"Updated rfis_id_seq to {max_rfi_id}")
    
    # Update Check sequence
    postgres_cursor.execute("SELECT MAX(id) FROM checks")
    max_check_id = postgres_cursor.fetchone()[0]
    if max_check_id:
        postgres_cursor.execute(f"SELECT setval('checks_id_seq', {max_check_id})")
        print(f"Updated checks_id_seq to {max_check_id}")

def main():
    """Main migration function."""
    print("Starting RFI data migration from SQLite to PostgreSQL...")
    print(f"SQLite source: {SQLITE_DB_PATH}")
    print(f"PostgreSQL target: {POSTGRES_URL}")
    
    try:
        # Connect to databases
        sqlite_conn, postgres_conn = connect_databases()
        sqlite_cursor = sqlite_conn.cursor()
        postgres_cursor = postgres_conn.cursor()
        
        # Migrate RFIs first (since Checks reference RFIs)
        rfi_count = migrate_rfis(sqlite_cursor, postgres_cursor)
        
        # Then migrate Checks
        check_count = migrate_checks(sqlite_cursor, postgres_cursor)
        
        # Update sequences
        update_sequences(postgres_cursor)
        
        # Commit changes
        postgres_conn.commit()
        
        print(f"\nMigration completed successfully!")
        print(f"- Migrated {rfi_count} RFI records")
        print(f"- Migrated {check_count} Check records")
        
        # Verify migration
        postgres_cursor.execute("SELECT COUNT(*) FROM rfis")
        final_rfi_count = postgres_cursor.fetchone()[0]
        postgres_cursor.execute("SELECT COUNT(*) FROM checks")
        final_check_count = postgres_cursor.fetchone()[0]
        
        print(f"\nVerification:")
        print(f"- PostgreSQL RFI count: {final_rfi_count}")
        print(f"- PostgreSQL Check count: {final_check_count}")
        
    except Exception as e:
        print(f"Migration failed: {e}")
        if 'postgres_conn' in locals():
            postgres_conn.rollback()
        raise
    
    finally:
        # Close connections
        if 'sqlite_conn' in locals():
            sqlite_conn.close()
        if 'postgres_conn' in locals():
            postgres_conn.close()

if __name__ == "__main__":
    main()