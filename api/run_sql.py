#!/usr/bin/env python3
"""
Script to execute SQL files against the database
"""
import os
import sys
from dotenv import load_dotenv
import psycopg2

def run_sql_file(sql_file_path):
    """Execute SQL file against the database"""
    load_dotenv()
    database_url = os.getenv('DATABASE_URL', 'postgresql://user:password@localhost:5432/concretepro')
    
    try:
        # Connect to database
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor()
        
        # Read and execute the SQL file
        with open(sql_file_path, 'r') as f:
            sql_content = f.read()
        
        # Split the script by semicolons and execute each statement
        statements = [stmt.strip() for stmt in sql_content.split(';') if stmt.strip() and not stmt.strip().startswith('--')]
        
        for statement in statements:
            print(f'Executing: {statement[:50]}...')
            cursor.execute(statement)
            
            # If it's a SELECT statement, show results
            if statement.strip().upper().startswith('SELECT'):
                results = cursor.fetchall()
                if results:
                    print('Results:')
                    for row in results:
                        print(f'  {row}')
                else:
                    print('  No results')
            else:
                print(f'  Affected rows: {cursor.rowcount}')
        
        conn.commit()
        cursor.close()
        conn.close()
        print(f'Successfully executed SQL file: {sql_file_path}')
        return True
        
    except Exception as e:
        print(f'Error executing SQL file: {e}')
        return False

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print('Usage: python run_sql.py <sql_file_path>')
        sys.exit(1)
    
    sql_file = sys.argv[1]
    if not os.path.exists(sql_file):
        print(f'SQL file not found: {sql_file}')
        sys.exit(1)
    
    success = run_sql_file(sql_file)
    sys.exit(0 if success else 1)