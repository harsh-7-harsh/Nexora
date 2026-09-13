# NEXORA — Full-Stack Editing Learning Dashboard

NEXORA is now a small full-stack app: the existing futuristic frontend is served by an Express backend and user data is persisted in `data/nexora.json`.

## Features

- Register / login / logout
- Password hashing using Node's built-in `crypto.scryptSync`
- 30-day bearer sessions
- User-scoped Tasks, Notes, Projects and Focus Sessions
- Task completion sync
- Persistent notes and projects
- Focus-session history and derived dashboard stats
- Seed data for each newly registered user
- Local JSON persistence with an atomic write strategy
- No build step and no frontend framework

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`.

Development mode:

```bash
npm run dev
```

## API

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/bootstrap`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/notes`
- `PATCH /api/notes/:id`
- `DELETE /api/notes/:id`
- `POST /api/projects`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/focus/sessions`
- `GET /api/stats`

The current frontend automatically uses the API when it is served by the Express server. When opened directly as a local HTML file, it gracefully falls back to browser `localStorage`.

## Important deployment note

This is a strong learning/prototype backend, not a production SaaS stack yet. For production, move persistence to PostgreSQL, put the app behind HTTPS, move auth to secure HTTP-only cookies, add rate limiting, input validation, CSRF protection where applicable, backups and structured logging.
