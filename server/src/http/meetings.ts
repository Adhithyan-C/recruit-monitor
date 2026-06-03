import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from './middleware/requireAuth.js';
import type { MeetingService } from '../domain/MeetingService.js';
import type { TranscriptService } from '../domain/TranscriptService.js';
import { AgoraTokenService } from '../domain/AgoraTokenService.js';
import { NotFoundError } from '../lib/errors.js';
import { canViewMeeting } from '../policy/canViewMeeting.js';

export function createMeetingsRouter(
  meetingService: MeetingService,
  transcriptService: TranscriptService,
): Router {
  const router = Router();

  // GET /meetings/:meetingId
  router.get('/:meetingId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params['meetingId']!;
      const meeting = await meetingService.getMeetingWithNames(meetingId);

      if (!canViewMeeting(req.user!, meeting)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      res.json({
        meeting: {
          ...meeting,
          interviewerAgoraUid: meeting.interviewerId
            ? AgoraTokenService.deriveUid(meeting.id, meeting.interviewerId)
            : null,
          candidateAgoraUid: AgoraTokenService.deriveUid(meeting.id, meeting.candidateId),
        },
      });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }
      next(err);
    }
  });

  // GET /meetings/:meetingId/transcript?afterSeq=0&limit=100
  router.get('/:meetingId/transcript', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params['meetingId']!;
      const meeting   = await meetingService.getMeeting(meetingId);

      if (!canViewMeeting(req.user!, meeting)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const afterSeq = Math.max(0, parseInt(req.query['afterSeq'] as string ?? '0', 10) || 0);
      const limit    = Math.min(500, Math.max(1, parseInt(req.query['limit'] as string ?? '100', 10) || 100));
      const segments = await transcriptService.getSegments(meetingId, afterSeq, limit);
      res.json({ segments });
    } catch (err) {
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'Meeting not found', code: 'NOT_FOUND' });
        return;
      }
      next(err);
    }
  });

  // GET /meetings/:meetingId/notes?updatedAfter=<iso>
  router.get('/:meetingId/notes', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meetingId = req.params['meetingId']!;
      const meeting   = await meetingService.getMeeting(meetingId);

      if (!canViewMeeting(req.user!, meeting)) {
        res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
        return;
      }

      const updatedAfterRaw = req.query['updatedAfter'] as string | undefined;
      const allNotes = await transcriptService.getNotes(meetingId);
      const notes = updatedAfterRaw
        ? allNotes.filter((note) => note.updatedAt > new Date(updatedAfterRaw))
        : allNotes;
      res.json({ notes });
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
