# ConcretePro Python Backend

A FastAPI-based backend for the ConcretePro construction document management system with integrated Claude AI chatbot functionality.

## Features

- **FastAPI Framework**: Modern, fast web framework for building APIs
- **Claude AI Integration**: Intelligent chatbot for sheet navigation and document management
- **SQLAlchemy ORM**: Database operations with the existing SQLite database
- **Async Support**: Fully asynchronous for better performance
- **CORS Enabled**: Cross-origin resource sharing for frontend integration

## Setup

### 1. Install Dependencies

```bash
# Make the start script executable (if not already done)
chmod +x start.sh

# Run the startup script (creates venv and installs dependencies)
./start.sh
```

### 2. Manual Setup (Alternative)

```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### 3. Environment Variables

Make sure to set your Claude API key in `.env`:

```bash
CLAUDE_API_KEY=your_claude_api_key_here
```

## API Endpoints

### Chatbot
- `POST /api/chatbot` - Process chatbot messages

### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/{id}` - Get specific project

### Sheets
- `GET /api/sheets` - List sheets (optionally filtered by project)
- `GET /api/sheets/{id}` - Get specific sheet with SVG content

### Documents
- `GET /api/documents` - List documents for a project

### RFIs
- `GET /api/rfis` - List RFIs (with optional filters)

## Claude Agent Features

The Python backend includes a sophisticated Claude agent that can:

- **Natural Language Processing**: Understand construction-specific terminology
- **Sheet Navigation**: Open specific sheets by code (e.g., "open sheet A101")
- **Type-based Filtering**: List sheets by type ("show me structural drawings")
- **Smart Search**: Case-insensitive sheet code matching
- **SVG Content Handling**: Efficiently load and serve sheet SVG content

## Architecture Benefits

### Compared to Node.js Backend:

1. **Better Integration**: Python backend integrates seamlessly with existing Python processing scripts
2. **Performance**: FastAPI is one of the fastest Python frameworks
3. **Type Safety**: Full Pydantic model validation
4. **Async/Await**: Native async support for better concurrency
5. **Claude SDK**: Official Python SDK for Anthropic Claude
6. **Scientific Ecosystem**: Access to Python's rich scientific and data processing libraries

## Database

Uses the same SQLite database as the Node.js version, with SQLAlchemy models that match the Prisma schema.

## Development

```bash
# Run with auto-reload for development
uvicorn main:app --reload --port 8080

# Check API documentation
open http://localhost:8080/docs
```

The FastAPI automatically generates interactive API documentation at `/docs`.