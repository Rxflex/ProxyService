# Proxy Management Service

A microservice for managing and distributing proxies by email ID.

## Features

- REST API for proxy management
- Admin panel for proxy administration
- SQLite database for data persistence
- Basic authentication for admin access

## API Endpoints

### Public API

- `GET /api/proxy/:email` - Get current proxy for an email
- `POST /api/proxy/:email/rotate` - Request proxy rotation
  - Body: `{ "reason": "string" }`
- `GET /api/proxy/:email/history` - Get proxy rotation history

### Admin API (requires authentication)

- `GET /admin` - Admin panel interface
- `GET /api/admin/proxies` - List all proxies
- `POST /api/admin/proxies` - Add new proxy
  - Body: `{ "host": "string", "port": number, "username": "string", "password": "string" }`
- `POST /api/admin/proxies/:email/rotate` - Force proxy rotation
  - Body: `{ "reason": "string" }`

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will start on port 3000 by default. You can change this by setting the `PORT` environment variable.

## Admin Access

- URL: `http://localhost:3000/admin`
- Username: `admin`
- Password: `admin123`

## Docker Support

To run with Docker:

1. Build the image:
```bash
docker build -t proxy-service .
```

2. Run the container:
```bash
docker run -p 3000:3000 proxy-service
```

## Database

The service uses SQLite for data storage. The database file (`proxies.db`) will be created automatically in the project root directory.

## Development

For development with auto-reload:
```bash
npm run dev
``` 