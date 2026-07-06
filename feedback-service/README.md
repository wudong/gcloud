# Feedback Service

Shared feedback collection API — one service, multiple apps.

## Features

- ✅ **Text + screenshots** — JSON and multipart endpoints
- ✅ **Abuse protection** — rate limiting (5/min, 30/hour per IP) + honeypot field
- ✅ **Multi-app** — namespaced by `app_id`
- ✅ **Extensible metadata** — JSONB field for user agent, screen size, etc.
- ✅ **GitHub issue linking** — update feedback with issue URLs
- ✅ **Status workflow** — `new` → `reviewed` → `converted_to_issue` → `closed`
- ✅ **Admin dashboard** — built-in HTML UI at `/admin`
- ✅ **Auth** — public POST, authenticated GET/PATCH (Bearer token)

## Architecture

```
┌──────────────┐     POST /feedback      ┌──────────────────┐     ┌────────────┐
│  tt-players  │ ────────────────────────▶│                  │     │            │
└──────────────┘                          │  feedback-service │────▶│ Cloud SQL  │
┌──────────────────┐     POST /feedback    │  (Cloud Run)      │     │ PostgreSQL │
│ tt-learning-lib  │ ────────────────────▶│                  │     │            │
└──────────────────┘                      └──────────────────┘     └────────────┘
                                                 │
                                          GET /admin (auth)
                                                 │
                                          ┌──────┴──────┐
                                          │  Admin UI    │
                                          │  (browser)   │
                                          └─────────────┘
```

## API

### Public endpoints (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/feedback` | Submit feedback (JSON) |
| `POST` | `/feedback/multipart` | Submit feedback with screenshots (FormData) |

### Admin endpoints (Bearer token required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin` | Admin dashboard (HTML) |
| `GET` | `/admin/feedback` | List feedback (paginated, filterable) |
| `GET` | `/admin/feedback/:id` | Single feedback with attachment metadata |
| `PATCH` | `/admin/feedback/:id` | Update status / GitHub issue URL |
| `GET` | `/admin/feedback/attachments/:id` | Download attachment image |

### Submit feedback (JSON)

```bash
curl -X POST https://feedback-service-xxxxx-uc.a.run.app/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "tt-players",
    "message": "The leaderboard is broken",
    "message_type": "bug",
    "page_path": "/leaderboard",
    "metadata": { "userAgent": "Mozilla/5.0...", "screenSize": "1920x1080" }
  }'
```

### Submit feedback with screenshots

```bash
curl -X POST https://feedback-service-xxxxx-uc.a.run.app/feedback/multipart \
  -F "app_id=tt-players" \
  -F "message=Button is misaligned" \
  -F "message_type=bug" \
  -F "attachments=@screenshot.png"
```

### Update feedback (link to GitHub issue)

```bash
curl -X PATCH https://feedback-service-xxxxx-uc.a.run.app/admin/feedback/<id> \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status": "converted_to_issue", "github_issue_url": "https://github.com/user/repo/issues/42"}'
```

## Abuse Protection

| Mechanism | Details |
|---|---|
| **Rate limiting** | 5 submissions/min, 30/hour per IP |
| **Honeypot field** | Hidden `website` field — bots that fill it get silent 201 |
| **Content limits** | Message max 5,000 chars, attachments max 4 × 1 MB |
| **Image validation** | Only PNG/JPEG/WebP, magic-byte verified |

## Client library

```typescript
import { submitFeedback, configureFeedbackService } from './client';

configureFeedbackService('https://feedback-service-xxxxx-uc.a.run.app');

await submitFeedback({
  appId: 'tt-players',
  message: 'The leaderboard is broken',
  messageType: 'bug',
  pagePath: window.location.pathname,
  pageTitle: document.title,
  metadata: {
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
  },
});
```

### React hook

```tsx
import { useFeedback } from './client/react';

function FeedbackForm() {
  const { submit, isSubmitting, error, success } = useFeedback({ appId: 'tt-players' });

  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      await submit({ message: '...', messageType: 'bug' });
    }}>
      {/* ... */}
    </form>
  );
}
```

## Database schema

### `feedback`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `app_id` | VARCHAR(100) | App namespace |
| `name` | VARCHAR(255) | Optional |
| `email` | VARCHAR(255) | Optional |
| `message_type` | VARCHAR(50) | `bug`, `feature`, `general`, `data_accuracy` |
| `message` | TEXT | Feedback content |
| `page_path` | VARCHAR(500) | URL path |
| `page_title` | VARCHAR(200) | Page title |
| `metadata` | JSONB | Arbitrary key-value data |
| `status` | VARCHAR(30) | `new`, `reviewed`, `converted_to_issue`, `closed` |
| `github_issue_url` | VARCHAR(500) | Linked GitHub issue |
| `created_at` | TIMESTAMP | Auto-set |
| `updated_at` | TIMESTAMP | Auto-set |

### `feedback_attachments`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `feedback_id` | UUID | FK → feedback.id |
| `filename` | VARCHAR(255) | Original filename |
| `mime_type` | VARCHAR(100) | `image/png`, `image/jpeg`, `image/webp` |
| `size_bytes` | INTEGER | File size |
| `content` | BYTEA | Binary image data |
| `created_at` | TIMESTAMP | Auto-set |

## Local development

```bash
cp .env.example .env
# Edit .env: DATABASE_URL=postgres://app-user:pass@localhost:5432/app-db
# Set ADMIN_TOKEN=your-secret-token

bun install
bun run src/migrate.ts   # create tables
bun run dev               # start server on :3000
```

## Deployment

```bash
chmod +x deploy.sh
./deploy.sh
```

The service deploys to **Cloud Run** (serverless, scales to zero, $0 at this scale) connected to the existing Cloud SQL PostgreSQL instance. The admin token is auto-generated from the Cloudflare key secret.
