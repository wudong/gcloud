import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { cors } from 'hono/cors';
import getSql from './db';
import { checkRateLimit, SUBMIT_RATE_LIMIT, SUBMIT_RATE_LIMIT_HOURLY } from './rate-limit';
import { requireAuth } from './auth';
import { migrate } from './migrate';

// Auto-migrate on startup
migrate().catch((err) => console.error('Migration warning (may already exist):', err.message));

const app = new Hono();

app.use('*', cors());

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const FeedbackBody = z.object({
  app_id: z.string().max(100).optional().default('default'),
  name: z.string().max(255).optional().nullable(),
  email: z.string().email().max(255).or(z.literal('')).optional().nullable(),
  message_type: z.enum(['bug', 'feature', 'general', 'data_accuracy']).default('general'),
  message: z.string().min(3).max(5000),
  page_path: z.string().max(500).optional().nullable(),
  page_title: z.string().max(200).optional().nullable(),
  metadata: z.record(z.unknown()).optional().default({}),
  // Honeypot — bots fill this, we check manually after validation
  website: z.string().optional(),
});

const UpdateBody = z.object({
  status: z.enum(['new', 'reviewed', 'converted_to_issue', 'closed', 'dismissed']).optional(),
  github_issue_url: z.string().url().max(500).optional().nullable(),
});

const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_ATTACHMENTS = 4;
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getClientIp(c: any): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';
}

function checkAbuseProtection(c: any) {
  const ip = getClientIp(c);

  const perMinute = checkRateLimit(`submit:${ip}`, SUBMIT_RATE_LIMIT);
  if (!perMinute.allowed) {
    return { blocked: true, message: 'Too many requests. Please slow down.' };
  }

  const perHour = checkRateLimit(`submit-h:${ip}`, SUBMIT_RATE_LIMIT_HOURLY);
  if (!perHour.allowed) {
    return { blocked: true, message: 'Too many requests. Please try again later.' };
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// POST /feedback — JSON body (no attachments)
// ---------------------------------------------------------------------------
app.post('/feedback', zValidator('json', FeedbackBody), async (c) => {
  const body = c.req.valid('json');

  // Honeypot check
  if (body.website) {
    // Silently return success to not tip off bots
    return c.json({ success: true, id: '00000000-0000-0000-0000-000000000000' }, 201);
  }

  // Rate limit
  const abuse = checkAbuseProtection(c);
  if (abuse.blocked) {
    return c.json({ error: abuse.message }, 429);
  }

  const cleanEmail = body.email?.trim() || null;
  const cleanName = body.name?.trim() || null;

  try {
    const sql = getSql();
    const [row] = await sql`
      INSERT INTO feedback (app_id, name, email, message_type, message, page_path, page_title, metadata)
      VALUES (${body.app_id}, ${cleanName}, ${cleanEmail}, ${body.message_type}, ${body.message.trim()}, ${body.page_path?.trim() || null}, ${body.page_title?.trim() || null}, ${sql.json(body.metadata || {})})
      RETURNING id
    `;
    return c.json({ success: true, id: row.id }, 201);
  } catch (err) {
    console.error('Failed to save feedback:', err);
    return c.json({ error: 'Failed to save feedback: ' + (err instanceof Error ? err.message : String(err)) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /feedback/multipart — multipart form data (with attachments)
// ---------------------------------------------------------------------------
app.post('/feedback/multipart', async (c) => {
  // Rate limit
  const abuse = checkAbuseProtection(c);
  if (abuse.blocked) {
    return c.json({ error: abuse.message }, 429);
  }

  try {
    const formData = await c.req.formData();

    // Honeypot check
    if (formData.get('website')) {
      return c.json({ success: true, id: '00000000-0000-0000-0000-000000000000' }, 201);
    }

    const appId = (formData.get('app_id') as string) || 'default';
    const name = (formData.get('name') as string)?.trim() || null;
    const email = (formData.get('email') as string)?.trim() || null;
    const messageType = (formData.get('message_type') as string) || 'general';
    const message = (formData.get('message') as string)?.trim();
    const pagePath = (formData.get('page_path') as string)?.trim() || null;
    const pageTitle = (formData.get('page_title') as string)?.trim() || null;

    // Parse metadata if provided
    let metadata: Record<string, unknown> = {};
    const metadataStr = formData.get('metadata') as string;
    if (metadataStr) {
      try { metadata = JSON.parse(metadataStr); } catch { /* ignore */ }
    }

    if (!message || message.length < 3) {
      return c.json({ error: 'Message must be at least 3 characters' }, 400);
    }
    if (!['bug', 'feature', 'general', 'data_accuracy'].includes(messageType)) {
      return c.json({ error: 'Invalid message_type' }, 400);
    }

    // Collect attachments
    const attachmentFiles = formData.getAll('attachments') as File[];
    const attachments: Array<{ filename: string; mimeType: string; content: Buffer }> = [];

    for (const file of attachmentFiles) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        return c.json({ error: `Maximum ${MAX_ATTACHMENTS} attachments allowed` }, 400);
      }
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_IMAGE_TYPES[number])) {
        return c.json({ error: 'Attachments must be PNG, JPEG, or WebP' }, 400);
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return c.json({ error: 'Each attachment must be 1 MB or smaller' }, 400);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      attachments.push({
        filename: file.name || 'screenshot',
        mimeType: file.type,
        content: buffer,
      });
    }

    const sql = getSql();
    const [feedback] = await sql`
      INSERT INTO feedback (app_id, name, email, message_type, message, page_path, page_title, metadata)
      VALUES (${appId}, ${name}, ${email}, ${messageType}, ${message}, ${pagePath}, ${pageTitle}, ${sql.json(metadata)})
      RETURNING id
    `;

    if (attachments.length > 0) {
      await sql`
        INSERT INTO feedback_attachments ${sql(
          attachments.map((a) => ({
            feedback_id: feedback.id,
            filename: a.filename,
            mime_type: a.mimeType,
            size_bytes: a.content.length,
            content: a.content,
          })),
        )}
      `;
    }

    return c.json({ success: true, id: feedback.id }, 201);
  } catch (err) {
    console.error('Failed to save feedback (multipart):', err);
    return c.json({ error: 'Failed to save feedback' }, 500);
  }
});

// ===========================================================================
// Admin endpoints (require auth)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /admin/feedback — list all feedback (paginated, filterable)
// ---------------------------------------------------------------------------
app.get('/admin/feedback', requireAuth, async (c) => {
  const appId = c.req.query('app_id');
  const status = c.req.query('status');
  const githubLinked = c.req.query('github_linked'); // 'true' | 'false' | undefined
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = parseInt(c.req.query('offset') || '0');

  try {
    const sql = getSql();

    let query = sql`
      SELECT id, app_id, name, email, message_type, message, page_path, page_title,
             metadata, status, github_issue_url, created_at, updated_at
      FROM feedback WHERE 1=1
    `;
    let countQuery = sql`SELECT COUNT(*)::int as count FROM feedback WHERE 1=1`;

    if (appId) {
      query = sql`${query} AND app_id = ${appId}`;
      countQuery = sql`${countQuery} AND app_id = ${appId}`;
    }
    if (status) {
      query = sql`${query} AND status = ${status}`;
      countQuery = sql`${countQuery} AND status = ${status}`;
    }
    if (githubLinked === 'false') {
      query = sql`${query} AND github_issue_url IS NULL`;
      countQuery = sql`${countQuery} AND github_issue_url IS NULL`;
    } else if (githubLinked === 'true') {
      query = sql`${query} AND github_issue_url IS NOT NULL`;
      countQuery = sql`${countQuery} AND github_issue_url IS NOT NULL`;
    }

    query = sql`${query} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const [rows, [countRow]] = await Promise.all([query, countQuery]);

    return c.json({ data: rows, total: countRow.count, limit, offset });
  } catch (err) {
    console.error('Failed to list feedback:', err);
    return c.json({ error: 'Failed to list feedback' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/feedback/:id — single feedback with attachments
// ---------------------------------------------------------------------------
app.get('/admin/feedback/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  try {
    const sql = getSql();
    const [feedback] = await sql`
      SELECT id, app_id, name, email, message_type, message, page_path, page_title,
             metadata, status, github_issue_url, created_at, updated_at
      FROM feedback WHERE id = ${id}
    `;
    if (!feedback) return c.json({ error: 'Not found' }, 404);

    const attachments = await sql`
      SELECT id, filename, mime_type, size_bytes, created_at
      FROM feedback_attachments WHERE feedback_id = ${id} ORDER BY created_at
    `;

    return c.json({ ...feedback, attachments });
  } catch (err) {
    console.error('Failed to get feedback:', err);
    return c.json({ error: 'Failed to get feedback' }, 500);
  }
});

// ---------------------------------------------------------------------------
// PATCH /admin/feedback/:id — update status / github issue link
// ---------------------------------------------------------------------------
app.patch('/admin/feedback/:id', requireAuth, zValidator('json', UpdateBody), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');

  try {
    const sql = getSql();
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.github_issue_url !== undefined) updates.github_issue_url = body.github_issue_url;

    const [row] = await sql`
      UPDATE feedback SET ${sql(updates)} WHERE id = ${id}
      RETURNING id, status, github_issue_url, updated_at
    `;
    if (!row) return c.json({ error: 'Not found' }, 404);

    return c.json({ success: true, ...row });
  } catch (err) {
    console.error('Failed to update feedback:', err);
    return c.json({ error: 'Failed to update feedback' }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/feedback/:id — hard delete a feedback entry
// ---------------------------------------------------------------------------
app.delete('/admin/feedback/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  try {
    const sql = getSql();
    const [row] = await sql`
      DELETE FROM feedback WHERE id = ${id}
      RETURNING id
    `;
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ success: true, id: row.id });
  } catch (err) {
    console.error('Failed to delete feedback:', err);
    return c.json({ error: 'Failed to delete feedback' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/feedback/attachments/:id — download attachment (auth required)
// ---------------------------------------------------------------------------
app.get('/admin/feedback/attachments/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  try {
    const sql = getSql();
    const [row] = await sql`
      SELECT filename, mime_type, content FROM feedback_attachments WHERE id = ${id}
    `;
    if (!row) return c.json({ error: 'Attachment not found' }, 404);

    return new Response(row.content, {
      headers: {
        'Content-Type': row.mime_type,
        'Content-Disposition': `inline; filename="${row.filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('Failed to get attachment:', err);
    return c.json({ error: 'Failed to get attachment' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /admin — simple admin dashboard (HTML)
// ---------------------------------------------------------------------------
app.get('/admin', requireAuth, async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Feedback Admin</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
  .header { background: #1a1a2e; color: #fff; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 20px; }
  .filters { padding: 16px 24px; background: #fff; border-bottom: 1px solid #e0e0e0; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .filters select, .filters button { padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
  .filters button { background: #1a1a2e; color: #fff; cursor: pointer; border: none; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .card { background: #fff; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .card-meta { font-size: 13px; color: #666; display: flex; gap: 16px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .badge-bug { background: #fde8e8; color: #c53030; }
  .badge-feature { background: #e8f4fd; color: #2b6cb0; }
  .badge-general { background: #edf2f7; color: #4a5568; }
  .badge-data_accuracy { background: #fefcbf; color: #975a16; }
  .badge-new { background: #e8f4fd; color: #2b6cb0; }
  .badge-reviewed { background: #edf2f7; color: #4a5568; }
  .badge-converted_to_issue { background: #c6f6d5; color: #276749; }
  .badge-closed { background: #e0e0e0; color: #666; }
  .message { white-space: pre-wrap; line-height: 1.5; margin: 8px 0; }
  .attachments { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  .attachments img { max-width: 200px; max-height: 150px; border-radius: 6px; border: 1px solid #e0e0e0; cursor: pointer; }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions select, .actions button { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
  .actions button { background: #1a1a2e; color: #fff; cursor: pointer; border: none; }
  .gh-link { color: #2b6cb0; font-size: 13px; }
  .pagination { display: flex; gap: 8px; justify-content: center; margin: 24px 0; }
  .pagination button { padding: 8px 16px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; }
  .pagination button:disabled { opacity: 0.5; cursor: default; }
  .loading { text-align: center; padding: 40px; color: #666; }
  .empty { text-align: center; padding: 40px; color: #999; }
  .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; justify-content: center; align-items: center; }
  .modal.active { display: flex; }
  .modal img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: #1a1a2e; color: #fff; padding: 12px 20px; border-radius: 8px; font-size: 14px; z-index: 2000; opacity: 0; transition: opacity 0.3s; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="header">
  <h1>📋 Feedback Admin</h1>
  <span id="token-status">🔒 Authenticated</span>
</div>
<div class="filters">
  <select id="filter-app">
    <option value="">All apps</option>
  </select>
  <select id="filter-status">
    <option value="">All statuses</option>
    <option value="new">New</option>
    <option value="reviewed">Reviewed</option>
    <option value="converted_to_issue">Converted to issue</option>
    <option value="closed">Closed</option>
    <option value="dismissed">Dismissed</option>
  </select>
  <select id="filter-gh">
    <option value="">All (linked or not)</option>
    <option value="false">No GitHub issue</option>
    <option value="true">Has GitHub issue</option>
  </select>
  <button onclick="loadFeedback()">🔄 Refresh</button>
  <span id="total-count" style="font-size:14px;color:#666;"></span>
</div>
<div class="container" id="feedback-list">
  <div class="loading">Loading...</div>
</div>
<div class="pagination" id="pagination"></div>
<div class="modal" id="image-modal" onclick="this.classList.remove('active')">
  <img id="modal-img" src="" alt="Screenshot" />
</div>
<div class="toast" id="toast"></div>

<script>
const BASE = '';
const TOKEN = localStorage.getItem('admin_token') || '';

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { ...opts.headers, 'Authorization': 'Bearer ' + TOKEN },
  });
  if (res.status === 401) { alert('Session expired. Reload and re-enter token.'); throw new Error('Unauthorized'); }
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || 'Request failed'); }
  return res.json();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

async function loadFeedback(page = 0) {
  const list = document.getElementById('feedback-list');
  list.innerHTML = '<div class="loading">Loading...</div>';

  const appId = document.getElementById('filter-app').value;
  const status = document.getElementById('filter-status').value;
  const limit = 20;
  const params = new URLSearchParams({ limit, offset: page * limit });
  if (appId) params.set('app_id', appId);
  if (status) params.set('status', status);

  try {
    const { data, total } = await api('/admin/feedback?' + params);
    document.getElementById('total-count').textContent = total + ' total';

    if (data.length === 0) {
      list.innerHTML = '<div class="empty">No feedback found.</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    list.innerHTML = data.map(f => {
      const typeBadge = 'badge-' + f.message_type;
      const statusBadge = 'badge-' + f.status;
      const meta = f.metadata && typeof f.metadata === 'object' ? f.metadata : {};
      const metaStr = Object.entries(meta).filter(([k]) => k !== 'website')
        .map(([k,v]) => '<span>' + k + ': ' + JSON.stringify(v) + '</span>').join('');

      return '<div class="card">' +
        '<div class="card-header">' +
          '<div><span class="badge ' + typeBadge + '">' + f.message_type + '</span> ' +
          '<span class="badge ' + statusBadge + '">' + f.status + '</span> ' +
          '<strong style="margin-left:8px">' + (f.app_id || 'default') + '</strong></div>' +
          '<div style="font-size:12px;color:#999">' + new Date(f.created_at).toLocaleString() + '</div>' +
        '</div>' +
        '<div class="card-meta">' +
          (f.name ? '<span>👤 ' + escapeHtml(f.name) + '</span>' : '') +
          (f.email ? '<span>📧 ' + escapeHtml(f.email) + '</span>' : '') +
          (f.page_path ? '<span>📍 ' + escapeHtml(f.page_path) + '</span>' : '') +
          (f.page_title ? '<span>📄 ' + escapeHtml(f.page_title) + '</span>' : '') +
          metaStr +
        '</div>' +
        '<div class="message">' + escapeHtml(f.message) + '</div>' +
        (f.github_issue_url ? '<a class="gh-link" href="' + f.github_issue_url + '" target="_blank">🔗 GitHub Issue</a>' : '') +
        (f.attachments && f.attachments.length > 0 ? '<div class="attachments">' +
          f.attachments.map(a => '<img src="/admin/feedback/attachments/' + a.id + '" alt="' + a.filename + '" onclick="event.stopPropagation();openModal(this.src)" loading="lazy" />').join('') +
        '</div>' : '') +
        '<div class="actions">' +
          '<select onchange="updateStatus(\\'' + f.id + '\\', this.value)"><option value="">Status...</option>' +
            '<option value="new">New</option><option value="reviewed">Reviewed</option>' +
            '<option value="converted_to_issue">Converted to issue</option><option value="closed">Closed</option>' +
          '</select>' +
          '<input type="url" placeholder="GitHub issue URL" id="gh-' + f.id + '" value="' + (f.github_issue_url || '') + '" style="padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:13px;flex:1;min-width:200px;" />' +
          '<button onclick="updateGithub(\\'' + f.id + '\\')">Save</button>' +
        '</div>' +
      '</div>';
    }).join('');

    // Pagination
    const totalPages = Math.ceil(total / limit);
    const pag = document.getElementById('pagination');
    pag.innerHTML = '';
    if (totalPages > 1) {
      pag.innerHTML = '<button ' + (page === 0 ? 'disabled' : '') + ' onclick="loadFeedback(' + (page-1) + ')">← Prev</button>' +
        '<span style="padding:8px">Page ' + (page+1) + ' of ' + totalPages + '</span>' +
        '<button ' + (page >= totalPages-1 ? 'disabled' : '') + ' onclick="loadFeedback(' + (page+1) + ')">Next →</button>';
    }

    // Populate app filter
    const apps = [...new Set(data.map(f => f.app_id))];
    const sel = document.getElementById('filter-app');
    apps.forEach(a => { if (![...sel.options].some(o => o.value === a)) { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; sel.appendChild(opt); } });
  } catch (err) {
    list.innerHTML = '<div class="empty">Error: ' + err.message + '</div>';
  }
}

async function updateStatus(id, status) {
  if (!status) return;
  try {
    await api('/admin/feedback/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    showToast('Status updated to ' + status);
    loadFeedback(currentPage);
  } catch (err) { showToast('Error: ' + err.message); }
}

async function updateGithub(id) {
  const url = document.getElementById('gh-' + id).value.trim();
  try {
    await api('/admin/feedback/' + id, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ github_issue_url: url || null, status: url ? 'converted_to_issue' : undefined })
    });
    showToast('Saved!');
    loadFeedback(currentPage);
  } catch (err) { showToast('Error: ' + err.message); }
}

function openModal(src) {
  document.getElementById('modal-img').src = src;
  document.getElementById('image-modal').classList.add('active');
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let currentPage = 0;
document.getElementById('filter-app').addEventListener('change', () => { currentPage = 0; loadFeedback(0); });
document.getElementById('filter-status').addEventListener('change', () => { currentPage = 0; loadFeedback(0); });

// Init
if (!TOKEN) {
  const t = prompt('Enter admin token:');
  if (t) { localStorage.setItem('admin_token', t); location.reload(); }
  else { document.body.innerHTML = '<div style="padding:40px;text-align:center"><h2>Admin token required</h2><p>Reload to try again.</p></div>'; }
} else {
  loadFeedback(0);
}
</script>
</body>
</html>`;
  return c.html(html);
});

export default { port: parseInt(process.env.PORT || '3000'), fetch: app.fetch };
