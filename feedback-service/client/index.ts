/**
 * Feedback Service — Shared Client
 *
 * Lightweight client for submitting feedback to the shared feedback service.
 * Works in browser and Node.js. Zero dependencies.
 *
 * Usage:
 *   import { submitFeedback, submitFeedbackWithScreenshots } from '@gcloud/feedback-service/client';
 *
 *   await submitFeedback({
 *     appId: 'tt-players',
 *     message: 'The leaderboard is broken',
 *     messageType: 'bug',
 *   });
 */

export type FeedbackType = 'bug' | 'feature' | 'general' | 'data_accuracy';

export interface FeedbackPayload {
  appId?: string;
  name?: string | null;
  email?: string | null;
  messageType?: FeedbackType;
  message: string;
  pagePath?: string | null;
  pageTitle?: string | null;
  /** Arbitrary metadata (user agent, screen size, etc.) */
  metadata?: Record<string, unknown>;
}

export interface FeedbackResponse {
  success: boolean;
  id: string;
}

const DEFAULT_BASE_URL = 'https://feedback.graceliu.uk';

let _baseUrl = DEFAULT_BASE_URL;

export function configureFeedbackService(baseUrl: string) {
  _baseUrl = baseUrl.replace(/\/+$/, '');
}

async function postJson(path: string, body: unknown): Promise<FeedbackResponse> {
  const res = await fetch(`${_baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResponse> {
  return postJson('/feedback', {
    app_id: payload.appId || 'default',
    name: payload.name?.trim() || null,
    email: payload.email?.trim() || null,
    message_type: payload.messageType || 'general',
    message: payload.message.trim(),
    page_path: payload.pagePath?.trim() || null,
    page_title: payload.pageTitle?.trim() || null,
    metadata: payload.metadata || {},
  });
}

export async function submitFeedbackWithScreenshots(
  payload: FeedbackPayload,
  screenshots: File[],
): Promise<FeedbackResponse> {
  const formData = new FormData();
  formData.set('app_id', payload.appId || 'default');
  formData.set('name', payload.name?.trim() || '');
  formData.set('email', payload.email?.trim() || '');
  formData.set('message_type', payload.messageType || 'general');
  formData.set('message', payload.message.trim());
  formData.set('page_path', payload.pagePath?.trim() || '');
  formData.set('page_title', payload.pageTitle?.trim() || '');
  if (payload.metadata) {
    formData.set('metadata', JSON.stringify(payload.metadata));
  }

  for (const file of screenshots) {
    formData.append('attachments', file);
  }

  const res = await fetch(`${_baseUrl}/feedback/multipart`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
