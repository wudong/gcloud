/**
 * React hook for the shared feedback service.
 *
 * Usage:
 *   import { useFeedback } from '@gcloud/feedback-service/client/react';
 *
 *   function MyPage() {
 *     const { submit, isSubmitting, error, success } = useFeedback({ appId: 'my-app' });
 *     // ...
 *   }
 */
import { useState, useCallback } from 'react';
import {
  submitFeedback,
  submitFeedbackWithScreenshots,
  type FeedbackPayload,
  type FeedbackResponse,
} from '../index';

export interface UseFeedbackOptions {
  appId: string;
}

export interface UseFeedbackResult {
  isSubmitting: boolean;
  error: string | null;
  success: boolean;
  lastId: string | null;
  submit: (payload: Omit<FeedbackPayload, 'appId'>) => Promise<FeedbackResponse | null>;
  submitWithScreenshots: (
    payload: Omit<FeedbackPayload, 'appId'>,
    screenshots: File[],
  ) => Promise<FeedbackResponse | null>;
  reset: () => void;
}

export function useFeedback(options: UseFeedbackOptions): UseFeedbackResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [lastId, setLastId] = useState<string | null>(null);

  const doSubmit = useCallback(
    async (payload: Omit<FeedbackPayload, 'appId'>, screenshots?: File[]) => {
      if (!payload.message || payload.message.trim().length < 3) {
        setError('Message must be at least 3 characters');
        return null;
      }
      setIsSubmitting(true);
      setError(null);
      try {
        const fullPayload: FeedbackPayload = { ...payload, appId: options.appId };
        const result = screenshots && screenshots.length > 0
          ? await submitFeedbackWithScreenshots(fullPayload, screenshots)
          : await submitFeedback(fullPayload);
        setSuccess(true);
        setLastId(result.id);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to send feedback';
        setError(msg);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [options.appId],
  );

  const submit = useCallback(
    (payload: Omit<FeedbackPayload, 'appId'>) => doSubmit(payload),
    [doSubmit],
  );

  const submitWithScreenshots = useCallback(
    (payload: Omit<FeedbackPayload, 'appId'>, screenshots: File[]) => doSubmit(payload, screenshots),
    [doSubmit],
  );

  const reset = useCallback(() => {
    setError(null);
    setSuccess(false);
    setLastId(null);
  }, []);

  return { isSubmitting, error, success, lastId, submit, submitWithScreenshots, reset };
}
