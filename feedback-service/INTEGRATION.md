# Feedback Service — Integration Guide

A shared feedback collection API. One service, many apps. Use this document to wire
feedback submission (text + screenshots) into any project.

- **Base URL (production):** `https://feedback.graceliu.uk`
- **Region / project:** Cloud Run, `us-central1`, project `wudong-agent-master`
- **Runtime:** Hono on Bun, PostgreSQL (Cloud SQL) backend
- **Admin dashboard:** `https://feedback.graceliu.uk/admin` (Bearer-token protected)
- **Source:** [`feedback-service/`](.) in the `gcloud` repo

---

## 1. How it works

```
Your app  ──POST /feedback──▶  feedback-service (Cloud Run)  ──▶  Cloud SQL PostgreSQL
            (no auth)              namespaced by app_id              tables: feedback,
                                                                     feedback_attachments
```

- **Public endpoints** (`POST /feedback`, `POST /feedback/multipart`) require **no auth**.
  Anyone can submit. Spam/abuse is handled by rate limiting + a honeypot field.
- **Admin endpoints** (`/admin/*`) require a `Bearer` admin token. Use these to triage,
  link GitHub issues, download screenshots, or delete entries — typically from the
  built-in `/admin` dashboard, not from your app.
- Every submission is namespaced by an **`app_id`** so one service can serve many apps.
  Pick a stable, lowercase `app_id` for your project (e.g. `tt-players`, `sport-graph`)
  and use it on every request.

---

## 2. Quick start (submit feedback from any app)

### 2a. Plain `fetch` (browser or Node 18+)

```js
await fetch('https://feedback.graceliu.uk/feedback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    app_id: 'my-app',
    message: 'The leaderboard is broken',
    message_type: 'bug',
    page_path: window.location.pathname,
    page_title: document.title,
    metadata: {
      userAgent: navigator.userAgent,
      screenSize: `${window.innerWidth}x${window.innerHeight}`,
    },
  }),
});
// => { "success": true, "id": "e796f78c-fe48-43a2-b093-fcdfd4f8cccc" }  (201)
```

### 2b. `curl` (smoke test)

```bash
curl -X POST https://feedback.graceliu.uk/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "my-app",
    "message": "Button is misaligned on mobile",
    "message_type": "bug",
    "page_path": "/settings"
  }'
```

### 2c. Bundled client library (TypeScript)

The service ships a zero-dependency client in [`client/`](client). Copy `client/index.ts`
(and optionally `client/react.ts`) into your project, or import it from the repo.

```ts
import { configureFeedbackService, submitFeedback } from './client';

// Call once at app startup
configureFeedbackService('https://feedback.graceliu.uk');

await submitFeedback({
  appId: 'my-app',
  message: 'The leaderboard is broken',
  messageType: 'bug',
  pagePath: window.location.pathname,
  pageTitle: document.title,
  metadata: {
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
  },
});
// => { success: true, id: "..." }
```

### 2d. React hook

```tsx
import { useFeedback } from './client/react';
import { configureFeedbackService } from './client';

configureFeedbackService('https://feedback.graceliu.uk');

function FeedbackForm() {
  const { submit, isSubmitting, error, success, reset } = useFeedback({ appId: 'my-app' });

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const message = (form.elements.namedItem('message') as HTMLTextAreaElement).value;
        await submit({ message, messageType: 'bug', pagePath: window.location.pathname });
      }}
    >
      <textarea name="message" minLength={3} maxLength={5000} required />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {success && <p>Thanks for your feedback!</p>}
    </form>
  );
}
```

The hook exposes: `submit`, `submitWithScreenshots`, `isSubmitting`, `error`, `success`,
`lastId`, `reset`. `appId` is fixed at the hook call site; pass everything else per-submit.

---

## 3. Public endpoints

All public endpoints are **CORS-enabled** (`*`), so browsers can call them directly.

### `POST /feedback` — text feedback (JSON)

**Request body** (`application/json`):

| Field | Type | Required | Default | Constraints |
|---|---|---|---|---|
| `app_id` | string | no | `"default"` | max 100 chars — **set this to your project's id** |
| `message` | string | **yes** | — | 3–5000 chars (whitespace-trimmed) |
| `message_type` | enum | no | `"general"` | `bug` \| `feature` \| `general` \| `data_accuracy` |
| `name` | string \| null | no | `null` | max 255 chars |
| `email` | string \| null | no | `null` | must be a valid email if non-empty; max 255 |
| `page_path` | string \| null | no | `null` | max 500 chars — e.g. `window.location.pathname` |
| `page_title` | string \| null | no | `null` | max 200 chars — e.g. `document.title` |
| `metadata` | object | no | `{}` | arbitrary JSON; good for `userAgent`, `screenSize`, app version, user id, etc. |
| `website` | string | no | — | **honeypot** — leave it out / empty. If filled, the request is silently accepted but discarded (bot trap). |

**Response** `201 Created`:
```json
{ "success": true, "id": "e796f78c-fe48-43a2-b093-fcdfd4f8cccc" }
```

**Error responses:**
- `400` — validation failed (`{ "error": "..." }`)
- `429` — rate limited (`{ "error": "Too many requests. Please slow down." }`)
- `500` — server error (`{ "error": "Failed to save feedback: ..." }`)

### `POST /feedback/multipart` — feedback with screenshots

Use `multipart/form-data`. Same logical fields as above, but sent as form fields, plus
one or more `attachments` files.

**Form fields:**

| Field | Type | Notes |
|---|---|---|
| `app_id` | string | default `"default"` |
| `message` | string | required, 3–5000 chars |
| `message_type` | string | `bug` \| `feature` \| `general` \| `data_accuracy` |
| `name`, `email`, `page_path`, `page_title` | string | optional |
| `metadata` | string (JSON) | optional — a JSON-encoded string, e.g. `'{"userAgent":"..."}'` |
| `attachments` | File[] | optional — repeat the field for multiple files |
| `website` | string | **honeypot** — leave empty |

**Attachment rules:**
- Max **4** attachments per request.
- Max **1 MB** each.
- Allowed MIME types only: `image/png`, `image/jpeg`, `image/webp` (magic-byte verified server-side).

**Response:** `201 Created` → `{ "success": true, "id": "..." }`
(Errors same shape as `/feedback`.)

**Example with the bundled client:**
```ts
import { configureFeedbackService, submitFeedbackWithScreenshots } from './client';
configureFeedbackService('https://feedback.graceliu.uk');

const files = Array.from(document.querySelectorAll('input[type=file]')).files;
await submitFeedbackWithScreenshots(
  { appId: 'my-app', message: 'See screenshot', messageType: 'bug' },
  files,
);
```

### `GET /health`

```bash
curl https://feedback.graceliu.uk/health
# => { "status": "ok", "timestamp": "2026-07-06T13:50:35.449Z" }
```
Use this for uptime checks / load-balancer probes.

---

## 4. Admin endpoints (Bearer token required)

All `/admin/*` routes require:
```
Authorization: Bearer <ADMIN_TOKEN>
```
The token is stored in GCP Secret Manager as `feedback-admin-token` (project
`wudong-agent-master`) and injected into the Cloud Run service as the `ADMIN_TOKEN`
env var. **Never ship this token in a client app** — admin access is for your
internal tooling / the built-in dashboard only.

### `GET /admin` — built-in dashboard (HTML)

Open `https://feedback.graceliu.uk/admin` in a browser. On first load it prompts for the
admin token (stored in `localStorage`). You can then filter by app / status / GitHub-link,
page through results, change status, attach a GitHub issue URL, view screenshots in a
lightbox, and the app filter auto-populates from submitted `app_id`s.

### `GET /admin/feedback` — list feedback

Query params (all optional):

| Param | Values | Notes |
|---|---|---|
| `app_id` | string | filter to one app |
| `status` | `new` \| `reviewed` \| `converted_to_issue` \| `closed` \| `dismissed` | filter by status |
| `github_linked` | `true` \| `false` | has/doesn't-have a GitHub issue URL |
| `limit` | int | default 50, capped at 200 |
| `offset` | int | default 0, for pagination |

```bash
curl https://feedback.graceliu.uk/admin/feedback?app_id=my-app&status=new&limit=20 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response:**
```json
{
  "data": [
    {
      "id": "e796f78c-...",
      "app_id": "my-app",
      "name": null,
      "email": null,
      "message_type": "bug",
      "message": "Button is misaligned",
      "page_path": "/settings",
      "page_title": null,
      "metadata": {},
      "status": "new",
      "github_issue_url": null,
      "created_at": "2026-07-06T13:50:35.449Z",
      "updated_at": "2026-07-06T13:50:35.449Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### `GET /admin/feedback/:id` — single feedback (with attachments)

```bash
curl https://feedback.graceliu.uk/admin/feedback/e796f78c-... \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
Returns the feedback row plus an `attachments` array (`id`, `filename`, `mime_type`,
`size_bytes`, `created_at`). `404` if not found.

### `PATCH /admin/feedback/:id` — update status / GitHub link

```bash
curl -X PATCH https://feedback.graceliu.uk/admin/feedback/e796f78c-... \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"converted_to_issue","github_issue_url":"https://github.com/me/repo/issues/42"}'
```
Body (all optional, at least one recommended):

| Field | Values |
|---|---|
| `status` | `new` \| `reviewed` \| `converted_to_issue` \| `closed` \| `dismissed` |
| `github_issue_url` | valid URL (max 500), or `null` to clear |

Returns `{ "success": true, "id": "...", "status": "...", "github_issue_url": "...", "updated_at": "..." }`.

### `DELETE /admin/feedback/:id` — hard delete

```bash
curl -X DELETE https://feedback.graceliu.uk/admin/feedback/e796f78c-... \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
Deletes the row and its attachments (cascade). Returns `{ "success": true, "id": "..." }`.

### `GET /admin/feedback/attachments/:id` — download attachment

```bash
curl https://feedback.graceliu.uk/admin/feedback/attachments/<attachment-id> \
  -H "Authorization: Bearer $ADMIN_TOKEN" --output screenshot.png
```
Returns the raw image with the correct `Content-Type` and an `inline` content-disposition.
`404` if not found. (The dashboard renders these inline as `<img>` srcs.)

---

## 5. Status workflow

```
new → reviewed → converted_to_issue → closed
                                   ↘ dismissed
```
- `new` — default on submission.
- `reviewed` — a human has looked at it.
- `converted_to_issue` — a GitHub issue has been created and its URL stored. The dashboard
  auto-sets this status when you save a GitHub URL.
- `closed` — resolved / no action needed.
- `dismissed` — spam / invalid (kept for record).

---

## 6. Abuse protection

| Mechanism | Limit |
|---|---|
| Rate limit (per IP) | **5 submissions / minute**, **30 / hour** |
| Honeypot field | `website` — bots that fill it get a fake `201` and are discarded |
| Message length | 3–5000 chars |
| Attachments | ≤ 4 per request, ≤ 1 MB each, PNG/JPEG/WebP only |
| CORS | `*` (public POST is intentionally open) |

Rate limits are in-memory per running instance, so under Cloud Run scale-out the effective
limit per IP is roughly `limit × instance_count`. At this service's scale (0–5 instances)
that's fine; revisit if you raise `--max-instances`.

---

## 7. Choosing an `app_id`

- Pick a **stable, lowercase, kebab-case** identifier for your project, e.g.
  `tt-players`, `tt-learning-library`, `sport-graph`, `vibe-marketing`.
- Use the **same** `app_id` on every submission so all feedback for a project groups together.
- The admin dashboard auto-discovers `app_id` values and adds them to its app filter — you
  don't need to register anything.
- Avoid `default` in production (it's the fallback when `app_id` is omitted) — always set it
  explicitly.

---

## 8. Recommended metadata

`metadata` is a free-form JSONB object. Suggested keys for richer triage:

```ts
metadata: {
  userAgent: navigator.userAgent,
  screenSize: `${window.innerWidth}x${window.innerHeight}`,
  appVersion: '1.4.2',          // your app's version
  userId: 'u_12345',            // your internal user id (if known)
  url: window.location.href,    // full URL, not just the path
  build: 'production',         // environment / build channel
  locale: navigator.language,
}
```
(The dashboard hides the honeypot `website` key if present.)

---

## 9. Error handling in clients

The service returns errors as `{ "error": "..." }` JSON. The bundled client throws an
`Error` with the server's message. Recommended UX:

- **`400`** (validation): show the message next to the field, e.g. "Message must be at least
  3 characters".
- **`429`** (rate limited): show "You're sending feedback too fast — try again in a minute."
  and disable the submit button briefly.
- **`5xx`** / network error: show a generic "Something went wrong. Please try again later."
  Do **not** retry aggressively (respect the rate limit).

Example guard:
```ts
try {
  await submitFeedback({ appId: 'my-app', message: '...', messageType: 'bug' });
} catch (e) {
  const msg = e instanceof Error ? e.message : 'Failed to send feedback';
  if (msg.includes('Too many')) showToast('Slow down — try again in a minute.');
  else showToast(msg);
}
```

---

## 10. Reference integration (checklist for a new project)

1. **Choose an `app_id`** — e.g. `sport-graph`.
2. **Copy the client** — drop [`client/index.ts`](client/index.ts) (and `client/react.ts` if
   React) into your project, or vendor the two functions inline (they're tiny).
3. **Configure once** at app entry:
   ```ts
   import { configureFeedbackService } from './client';
   configureFeedbackService('https://feedback.graceliu.uk');
   ```
4. **Add a feedback form** using `useFeedback({ appId: 'sport-graph' })`, or call
   `submitFeedback` / `submitFeedbackWithScreenshots` directly.
5. **Capture context** — always send `pagePath`, `pageTitle`, and useful `metadata`.
6. **Handle errors** per §9.
7. **Triage** at `https://feedback.graceliu.uk/admin` (filter by `app_id = sport-graph`),
   link GitHub issues, and view screenshots.
8. **Optional** — add an uptime probe to `GET /health` in your monitoring.

That's it. No backend, no database, no auth setup required in the consuming app — only a
stable `app_id` and the base URL.

---

## 11. Operational notes

- **Admin token:** stored in Secret Manager as `feedback-admin-token`. To rotate, add a new
  secret version and redeploy the service (`./deploy.sh` reads `latest`). Keep it out of
  client bundles and out of git.
- **DB password:** `feedback-db-password` in Secret Manager; DB user `feedback-service`,
  database `app-db` on Cloud SQL instance `wudong-agent-master:us-central1:wd-agents-pg`.
- **Rebuild / redeploy:** from this directory, `./deploy.sh` builds the linux/amd64 image,
  pushes to Artifact Registry, and redeploys Cloud Run with current secret values.
- **Schema migrations** run automatically on startup (`src/migrate.ts`, `CREATE TABLE IF NOT EXISTS`),
  so new columns/tables need a code change + redeploy, not a manual migration step.
- **Custom domain:** `feedback.graceliu.uk` (CNAME → `ghs.googlehosted.com`, Google-managed
  TLS cert). The raw Cloud Run URL
  (`https://feedback-service-4nf5vq2ygq-uc.a.run.app`) still works as a fallback.
- **Local dev:** `cp .env.example .env`, set `DATABASE_URL` + `ADMIN_TOKEN`, then
  `bun install && bun run src/migrate.ts && bun run dev` (serves on `:3000`).

---

## 12. Database schema (reference)

### `feedback`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `app_id` | VARCHAR(100) | namespacing key; default `default`; indexed |
| `name` | VARCHAR(255) | nullable |
| `email` | VARCHAR(255) | nullable |
| `message_type` | VARCHAR(50) | `bug`/`feature`/`general`/`data_accuracy`; default `general` |
| `message` | TEXT | the feedback content |
| `page_path` | VARCHAR(500) | nullable |
| `page_title` | VARCHAR(200) | nullable |
| `metadata` | JSONB | default `{}` |
| `status` | VARCHAR(30) | default `new`; indexed |
| `github_issue_url` | VARCHAR(500) | nullable |
| `created_at` | TIMESTAMP | default `now()`; indexed DESC |
| `updated_at` | TIMESTAMP | default `now()`; bumped on PATCH |

### `feedback_attachments`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `feedback_id` | UUID FK → `feedback(id)` | `ON DELETE CASCADE` |
| `filename` | VARCHAR(255) | original filename |
| `mime_type` | VARCHAR(100) | `image/png`/`jpeg`/`webp` |
| `size_bytes` | INTEGER | |
| `content` | BYTEA | binary image data |
| `created_at` | TIMESTAMP | default `now()` |

Indexes exist on `app_id`, `status`, `created_at DESC`, and
`feedback_attachments(feedback_id)`.