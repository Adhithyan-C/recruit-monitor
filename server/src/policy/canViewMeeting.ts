import type { InternalJwtPayload } from '../auth/jwt.js';
import type { MeetingDetails } from '../domain/MeetingService.js';

/**
 * Returns true if the authenticated user is permitted to read a meeting's
 * transcript and notes.
 *
 * Supervisors and admins see all meetings (monitoring / audit).
 * Interviewers see only meetings they conducted.
 * Candidates see only their own meeting.
 * All other roles are denied.
 */
export function canViewMeeting(
  user: InternalJwtPayload,
  meeting: MeetingDetails,
): boolean {
  switch (user.role) {
    case 'supervisor':
    case 'admin':
      return true;
    case 'interviewer':
      // Open meetings (interviewerId = null) must be viewable by any interviewer so
      // InterviewRoom can hydrate before or during the join_open_meeting flow.
      return meeting.interviewerId === null || user.userId === meeting.interviewerId;
    case 'candidate':
      return user.userId === meeting.candidateId;
    default:
      return false;
  }
}
