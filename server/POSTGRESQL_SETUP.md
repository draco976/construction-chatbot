# PostgreSQL Setup for ConcretePro

## 1. Install PostgreSQL

### macOS (using Homebrew):
```bash
brew install postgresql
brew services start postgresql
```

### Ubuntu/Debian:
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## 2. Create Database User and Database

```bash
# Connect to PostgreSQL as postgres user
sudo -u postgres psql

# Or on macOS:
psql postgres

# Create user and database
CREATE USER concretepro WITH PASSWORD 'concretepro123';
CREATE DATABASE concretepro OWNER concretepro;
GRANT ALL PRIVILEGES ON DATABASE concretepro TO concretepro;

# Exit PostgreSQL
\q
```

## 3. Verify Connection

```bash
psql -h localhost -U concretepro -d concretepro
```

## 4. Setup Python Environment

```bash
# Navigate to server directory
cd /Users/harshvardhanagarwal/Desktop/ConcretePro/server

# Create virtual environment (if not exists)
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

## 5. Setup Database Schema

```bash
# Run the database setup script
python setup_database.py
```

## 6. Start the Server

```bash
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

## Environment Variables

The `.env` file should contain:

```
DATABASE_URL=postgresql://concretepro:concretepro123@localhost:5432/concretepro
CLAUDE_API_KEY=your_claude_api_key_here
```

## Database Schema

The PostgreSQL database uses the following tables:
- `projects` - Project information
- `documents` - Document metadata
- `sheets` - Sheet information with references to documents
- `boxes` - Bounding boxes for sheet elements
- `references` - Cross-references between sheets
- `rfis` - Request for Information records
- `checks` - Individual check items within RFIs

All tables include `created_at` and `updated_at` timestamps for better data tracking.

## Benefits of PostgreSQL over SQLite

1. **Better Concurrency** - Multiple users can access simultaneously
2. **ACID Compliance** - Better data integrity
3. **Scalability** - Can handle larger datasets
4. **Advanced Features** - JSON columns, full-text search, etc.
5. **Production Ready** - Industry standard for web applications
6. **Better Performance** - Optimized for complex queries