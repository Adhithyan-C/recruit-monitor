import type { InternalJwtPayload } from '../auth/jwt.js';

/**
 * Returns true if the viewer may read any endpoint under
 * /candidates/:candidateId/history/*.
 *
 * Interviewers and supervisors see all candidates' history (pre-interview
 * context, audit). Candidates see only their own history.
 */
export function canViewCandidateHistory(
  viewer: InternalJwtPayload,
  candidateId: string,
): boolean {
  switch (viewer.role) {
    case 'interviewer':
    case 'supervisor':
    case 'admin':
      return true;
    case 'candidate':
      return viewer.userId === candidateId;
    default:
      return false;
  }
}
