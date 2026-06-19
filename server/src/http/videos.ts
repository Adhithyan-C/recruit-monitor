import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { requireAuth } from './middleware/requireAuth.js';
import type { MeetingService } from '../domain/MeetingService.js';
import { canViewMeeting } from '../policy/canViewMeeting.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { newId } from '../lib/ids.js';
import { NotFoundError, ForbiddenError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const BUCKET = 'interview-videos';

const ALLOWED_VIDEO_PREFIXES = ['video/mp4', 'video/webm', 'video/quicktime'];

const uploadUrlBodySchema = z.object({
  filename:    z.string().min(1).max(255),
  contentType: z.string().refine(
    (v) => ALLOWED_VIDEO_PREFIXES.some((prefix) => v === prefix || v.startsWith(`${prefix};`)),
    { message: 'contentType must be video/mp4, video/webm, or video/quicktime' },
  ),
});

const saveVideoBodySchema = z.object({
  storagePath:     z.string().min(1),
  type:            z.enum(['candidate_upload', 'interviewer_recording']),
  candidateName:   z.string().min(1),
  interviewerName: z.string().optional(),
});

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

export function createVideosRouter(meetingService: MeetingService, pool: Pool): Router {
  const router = Router();

  // POST /meetings/:meetingId/videos/upload-url
  router.post('/:meetingId/videos/upload-url', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params['meetingId']!;
      const meeting   = await meetingService.getMeeting(meetingId);

      if (!canViewMeeting(req.user!, meeting)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const { rows: approvedRows } = await pool.query(
        `SELECT 1 FROM meeting_videos WHERE candidate_id = $1
           AND approved_at IS NOT NULL LIMIT 1`,
        [meeting.candidateId],
      );
      if (approvedRows.length > 0) {
        throw new ForbiddenError('Video already approved; uploads locked', 'VIDEO_APPROVED_LOCKED');
      }

      const parsed = uploadUrlBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' });
        return;
      }

      const { filename, contentType } = parsed.data;
      const storagePath = `${meetingId}/${newId()}-${sanitizeFilename(filename)}`;

      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data) {
        logger.error({ error }, 'createSignedUploadUrl failed');
        res.status(500).json({ error: 'Failed to generate upload URL', code: 'INTERNAL_ERROR' });
        return;
      }

      res.json({ uploadUrl: data.signedUrl, storagePath });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }
      next(err);
    }
  });

  // POST /meetings/:meetingId/videos
  router.post('/:meetingId/videos', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params['meetingId']!;
      const meeting   = await meetingService.getMeeting(meetingId);

      if (!canViewMeeting(req.user!, meeting)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const { rows: approvedRows } = await pool.query(
        `SELECT 1 FROM meeting_videos WHERE candidate_id = $1
           AND approved_at IS NOT NULL LIMIT 1`,
        [meeting.candidateId],
      );
      if (approvedRows.length > 0) {
        throw new ForbiddenError('Video already approved; uploads locked', 'VIDEO_APPROVED_LOCKED');
      }

      const parsed = saveVideoBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid request body', code: 'VALIDATION_ERROR' });
        return;
      }

      const { storagePath, type, candidateName, interviewerName } = parsed.data;

      const result = await pool.query<{ id: string }>(
        `INSERT INTO meeting_videos
           (meeting_id, candidate_id, interviewer_id, candidate_name, interviewer_name, storage_path, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          meetingId,
          meeting.candidateId,
          meeting.interviewerId ?? null,
          candidateName,
          interviewerName ?? null,
          storagePath,
          type,
        ],
      );

      res.json({ videoId: result.rows[0]!.id });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }
      next(err);
    }
  });

  // GET /meetings/:meetingId/videos/:videoId/stream-url
  router.get('/:meetingId/videos/:videoId/stream-url', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params['meetingId']!;
      const videoId   = req.params['videoId']!;
      const meeting   = await meetingService.getMeeting(meetingId);

      if (!canViewMeeting(req.user!, meeting)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const result = await pool.query<{ storage_path: string }>(
        `SELECT storage_path FROM meeting_videos WHERE id = $1 AND meeting_id = $2`,
        [videoId, meetingId],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Video not found', code: 'NOT_FOUND' });
        return;
      }

      const { storage_path } = result.rows[0]!;

      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(storage_path, 3600);

      if (error || !data) {
        logger.error({ error }, 'createSignedUrl failed');
        res.status(500).json({ error: 'Failed to generate stream URL', code: 'INTERNAL_ERROR' });
        return;
      }

      res.json({ signedUrl: data.signedUrl });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }
      next(err);
    }
  });

  return router;
}
