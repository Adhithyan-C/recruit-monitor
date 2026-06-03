import type { Socket, Server } from 'socket.io';
import type { InternalJwtPayload } from '../auth/jwt.js';
import type { MeetingStatus, EndReason } from '../domain/meetingMachine.js';
import type { SegmentRow, NoteRow } from '../domain/TranscriptService.js';
import type { SessionRecord } from '../domain/SessionService.js';
import type { QueuedCandidate } from '../domain/PresenceService.js';

export interface ParticipantUids {
  interviewerUid: number | null;
  candidateUid:   number;
}

// ── Ack response — all client-initiated events use this shape ─────────

export type AckOk<T = undefined> = T extends undefined
  ? { ok: true }
  : { ok: true; data: T };

export type AckErr = { ok: false; error: string; code: string };
export type Ack<T = undefined> = AckOk<T> | AckErr;

// ── Shared server→client events ───────────────────────────────────────

interface SharedServerToClientEvents {
  meeting_status: (payload: {
    meetingId: string;
    status: MeetingStatus;
    interviewerName?: string | null;
    participantUids?: { interviewerUid: number; candidateUid: number };
  }) => void;
  transcript_segment:  (segment: SegmentRow) => void;
  transcript_error:    (payload: { meetingId: string }) => void;
  session_established: (payload: { reconnectToken: string; expiresAt: Date }) => void;
  session_replaced:    (payload: Record<string, never>) => void;
  socket_error:         (payload: { event: string; code: string; message: string }) => void;
  meeting_attached:     (payload: {
    meetingId:       string;
    status:          MeetingStatus;
    agoraChannel:    string;
    agoraToken:      string;
    uid:             number;
    candidateId:     string;
    interviewerId:   string | null;
    participantUids: ParticipantUids;
  }) => void;
  video_available:  (payload: { videoId: string; signedUrl: string; sharedBy: string }) => void;
  video_play_sync:  (payload: { videoId: string; currentTime: number }) => void;
  video_pause_sync: (payload: { videoId: string; currentTime: number }) => void;
  video_seek_sync:  (payload: { videoId: string; currentTime: number }) => void;
}

// Staff (interviewer + supervisor) only — candidates never receive note events.
interface StaffServerToClientEvents extends SharedServerToClientEvents {
  note_added:   (note: NoteRow) => void;
  note_updated: (payload: { noteId: string; body: string; updatedAt: Date }) => void;
  note_deleted: (payload: { noteId: string }) => void;
}

// ── Interviewer namespace ─────────────────────────────────────────────

export interface InterviewerClientToServerEvents {
  subscribe_open_rooms: (ack: (r: Ack<{ meetings: import('../domain/MeetingService.js').OpenMeetingDetails[] }>) => void) => void;
  join_open_meeting: (payload: { meetingId: string }, ack: (r: Ack) => void) => void;
  join_room:        (payload: { meetingId: string },                                              ack: (r: Ack<{ agoraToken: string; agoraChannel: string; uid: number; participantUids: ParticipantUids }>) => void) => void;
  end_meeting:      (payload: { meetingId: string; reason: EndReason },                           ack: (r: Ack) => void) => void;
  add_note:         (payload: { meetingId: string; anchorSegmentId?: string | null; body: string }, ack: (r: Ack<{ noteId: string }>) => void) => void;
  update_note:      (payload: { meetingId: string; noteId: string; body: string },                ack: (r: Ack) => void) => void;
  delete_note:      (payload: { meetingId: string; noteId: string },                              ack: (r: Ack) => void) => void;
  share_video:      (payload: { meetingId: string; videoId: string }) => void;
  video_play:       (payload: { meetingId: string; videoId: string; currentTime: number }) => void;
  video_pause:      (payload: { meetingId: string; videoId: string; currentTime: number }) => void;
  video_seek:       (payload: { meetingId: string; videoId: string; currentTime: number }) => void;
}

export interface InterviewerServerToClientEvents extends StaffServerToClientEvents {
  candidate_queue_update: (payload: { candidates: QueuedCandidate[] }) => void;
  open_rooms_update: (payload: { meetings: import('../domain/MeetingService.js').OpenMeetingDetails[] }) => void;
}

export interface InterviewerSocketData {
  user:       InternalJwtPayload & { exp: number; iat: number };
  meetingId?: string;
  session?:   SessionRecord;
}

export type InterviewerSocket = Socket<
  InterviewerClientToServerEvents,
  InterviewerServerToClientEvents,
  Record<string, never>,
  InterviewerSocketData
>;

export type InterviewerServer = Server<
  InterviewerClientToServerEvents,
  InterviewerServerToClientEvents,
  Record<string, never>,
  InterviewerSocketData
>;

// ── Candidate namespace ───────────────────────────────────────────────

export interface CandidateClientToServerEvents {
  heartbeat:     () => void;
  start_session: (ack: (r: Ack<{ meetingId: string; agoraChannel: string; agoraToken: string; uid: number; participantUids: ParticipantUids }>) => void) => void;
  audio_chunk:   (data: Buffer) => void;
  add_note:      (payload: { meetingId: string; anchorSegmentId?: string | null; body: string }, ack: (r: Ack<{ noteId: string }>) => void) => void;
  update_note:   (payload: { meetingId: string; noteId: string; body: string }, ack: (r: Ack) => void) => void;
  delete_note:   (payload: { meetingId: string; noteId: string }, ack: (r: Ack) => void) => void;
  share_video:   (payload: { meetingId: string; videoId: string }) => void;
  video_play:    (payload: { meetingId: string; videoId: string; currentTime: number }) => void;
  video_pause:   (payload: { meetingId: string; videoId: string; currentTime: number }) => void;
  video_seek:    (payload: { meetingId: string; videoId: string; currentTime: number }) => void;
}

export interface CandidateServerToClientEvents extends SharedServerToClientEvents {
  meeting_claimed: (payload: { meetingId: string }) => void;
  note_added:      (note: NoteRow) => void;
  note_updated:    (payload: { noteId: string; body: string; updatedAt: Date }) => void;
  note_deleted:    (payload: { noteId: string }) => void;
}

export interface CandidateSocketData {
  user:           InternalJwtPayload & { exp: number; iat: number };
  meetingId?:     string;
  meetingStatus?: MeetingStatus;
  session?:       SessionRecord;
}

export type CandidateSocket = Socket<
  CandidateClientToServerEvents,
  CandidateServerToClientEvents,
  Record<string, never>,
  CandidateSocketData
>;

// ── Supervisor namespace ──────────────────────────────────────────────

export interface ActiveMeetingInfo {
  id:              string;
  interviewerId:   string;
  candidateId:     string;
  interviewerName: string;
  candidateName:   string;
  agoraChannel:    string;
  status:          MeetingStatus;
}

export interface SupervisorClientToServerEvents {
  subscribe_active_meetings: (ack: (r: Ack<{ meetings: ActiveMeetingInfo[] }>) => void) => void;
  join_room: (
    payload: { meetingId: string },
    ack: (r: Ack<{ agoraToken: string; agoraChannel: string; uid: number; segments: SegmentRow[]; notes: NoteRow[]; participantUids: ParticipantUids }>) => void,
  ) => void;
}

export interface SupervisorServerToClientEvents extends StaffServerToClientEvents {
  candidate_queue_update: (payload: { candidates: QueuedCandidate[] }) => void;
}

export interface SupervisorSocketData {
  user:     InternalJwtPayload & { exp: number; iat: number };
  session?: SessionRecord;
}

export type SupervisorSocket = Socket<
  SupervisorClientToServerEvents,
  SupervisorServerToClientEvents,
  Record<string, never>,
  SupervisorSocketData
>;
