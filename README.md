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
- `DELETE /api/admin/proxies/:id` - Delete a proxy

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

The server will start on port 8888 by default. You can change this by setting the `PORT` environment variable.

## Admin Access

- URL: `http://localhost:8888/admin`
- Username: `admin`
- Password: `admin123`

## Docker Support

To run with Docker:

1. Build the image:
```bash
docker build -t proxy-service .
```

2. Run the container (default port 8888, database in container):
```bash
docker run -p 8888:8888 proxy-service
```

**To specify a custom port and mount a local database file:**
```bash
docker run -p 8080:8080 -e PORT=8080 -v /path/to/your/proxies.db:/app/proxies.db proxy-service
```
- `-p 8080:8080` — проброс порта 8080
- `-e PORT=8080` — задать переменную окружения для порта
- `-v /path/to/your/proxies.db:/app/proxies.db` — проброс локального файла базы данных внутрь контейнера

## Database

The service uses SQLite for data storage. The database file (`proxies.db`) will be created automatically in the project root directory.

## Development

For development with auto-reload:
```bash
npm run dev
```

## Удаление прокси

Для удаления прокси используйте метод:

```
DELETE /api/admin/proxies/:id
```

- Требуется basic auth (admin).
- Прокси не должен быть в использовании (`is_used = 0`).

## Docker и CI/CD

Dockerfile уже присутствует. Для автоматической сборки и публикации Docker-образа на архитектуры linux/amd64 и windows/amd64 добавлен workflow GitHub Actions (см. `.github/workflows/docker-publish.yml`).

Образ публикуется в GitHub Container Registry (ghcr.io).

**Пример получения и запуска образа:**
```bash
docker pull ghcr.io/<ваш_репозиторий>/proxy-service:latest
# Например:
docker run -p 8888:8888 ghcr.io/<ваш_репозиторий>/proxy-service:latest 