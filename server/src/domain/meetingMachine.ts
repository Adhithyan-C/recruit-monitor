import { InvalidTransitionError } from '../lib/errors.js';

// ── Types — mirror DB enums exactly ──────────────────────────────────

export type MeetingStatus =
  | 'open'          // candidate is alone in room, awaiting interviewer
  | 'waiting'
  | 'claimed'
  | 'connecting'
  | 'active'
  | 'interrupted'
  | 'ended'
  | 'cancelled';

export type CandidateStatus =
  | 'offline'
  | 'waiting'
  | 'claimed'
  | 'in_meeting'
  | 'disconnected';

export type EndReason =
  | 'interviewer_ended'
  | 'candidate_left'
  | 'grace_expired'
  | 'claim_expired'
  | 'admin_terminated'
  | 'error';

// ── Events ────────────────────────────────────────────────────────────

export type MeetingEvent =
  | 'interviewer_join' // interviewer joins an open solo room → active
  | 'claim'            // interviewer claims a waiting candidate (legacy)
  | 'candidate_join'   // candidate accepts a claim (legacy)
  | 'both_connected'   // both sides confirmed live in Agora (legacy)
  | 'disconnect'       // any participant loses connection
  | 'reconnect'        // disconnected participant comes back within grace
  | 'end'              // meeting is terminated
  | 'claim_expired'    // scheduler: CLAIM_TTL_SECONDS elapsed with no join
  | 'grace_expired'    // scheduler: GRACE_WINDOW_SECONDS elapsed with no reconnect
  | 'cancel';          // cancelled before reaching active

export type CandidateEvent =
  | 'open_meeting_created'  // candidate's solo room was created
  | 'socket_connect'        // candidate socket establishes connection (legacy)
  | 'socket_disconnect'     // candidate socket drops while waiting or claimed
  | 'claimed'               // interviewer claimed this candidate (legacy)
  | 'claim_expired'         // claim TTL elapsed — requeue (legacy)
  | 'meeting_active'        // meeting reached active state
  | 'participant_disconnect' // candidate drops during an active meeting
  | 'participant_reconnect'  // candidate comes back within the grace window
  | 'meeting_ended';         // meeting reached a terminal state

// ── Transition tables ─────────────────────────────────────────────────

type MeetingRule   = { from: ReadonlyArray<MeetingStatus>;   to: MeetingStatus   };
type CandidateRule = { from: ReadonlyArray<CandidateStatus>; to: CandidateStatus };

const MEETING_TRANSITIONS: Readonly<Record<MeetingEvent, MeetingRule>> = {
  interviewer_join: { from: ['open'],                              to: 'active'      },
  claim:            { from: ['waiting'],                           to: 'claimed'     },
  candidate_join:   { from: ['claimed'],                           to: 'connecting'  },
  both_connected:   { from: ['connecting'],                        to: 'active'      },
  disconnect:       { from: ['connecting', 'active'],              to: 'interrupted' },
  reconnect:        { from: ['interrupted'],                       to: 'active'      },
  end:              { from: ['open', 'active', 'interrupted'],     to: 'ended'       },
  claim_expired:    { from: ['claimed'],                           to: 'waiting'     },
  grace_expired:    { from: ['interrupted'],                       to: 'ended'       },
  cancel:           { from: ['waiting', 'claimed', 'connecting'],  to: 'cancelled'   },
};

const CANDIDATE_TRANSITIONS: Readonly<Record<CandidateEvent, CandidateRule>> = {
  open_meeting_created: { from: ['offline', 'waiting'],                    to: 'in_meeting'   },
  socket_connect:       { from: ['offline'],                               to: 'waiting'      },
  socket_disconnect:    { from: ['waiting', 'claimed'],                    to: 'offline'      },
  claimed:              { from: ['waiting'],                               to: 'claimed'      },
  claim_expired:        { from: ['claimed'],                               to: 'waiting'      },
  meeting_active:       { from: ['claimed', 'in_meeting'],                 to: 'in_meeting'   },
  participant_disconnect: { from: ['in_meeting'],                          to: 'disconnected' },
  participant_reconnect:  { from: ['disconnected'],                        to: 'in_meeting'   },
  meeting_ended:          { from: ['in_meeting', 'disconnected', 'claimed'], to: 'offline'    },
};

// ── Guards ────────────────────────────────────────────────────────────
// Return the next state or throw InvalidTransitionError — no side effects.

export function guardMeetingTransition(
  current: MeetingStatus,
  event: MeetingEvent,
): MeetingStatus {
  const rule = MEETING_TRANSITIONS[event];
  if (!(rule.from as ReadonlyArray<string>).includes(current)) {
    throw new InvalidTransitionError(current, event);
  }
  return rule.to;
}

export function guardCandidateTransition(
  current: CandidateStatus,
  event: CandidateEvent,
): CandidateStatus {
  const rule = CANDIDATE_TRANSITIONS[event];
  if (!(rule.from as ReadonlyArray<string>).includes(current)) {
    throw new InvalidTransitionError(current, event);
  }
  return rule.to;
}
