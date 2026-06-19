import { create } from 'zustand';

const initialState = {
  meetingId:           null,  // UUID — null until meeting is claimed
  agoraChannel:        null,  // Agora channel name — set from join_room / candidate_ready ack
  agoraUid:            null,  // integer, server-assigned — set from join ack (agoraToken is NOT stored here)
  candidateId:         null,  // userId of the candidate in this meeting
  interviewerId:       null,  // userId of the interviewer in this meeting
  candidateName:       null,  // display name — optional, populated when available
  interviewerName:     null,  // display name — optional, populated when available
  interviewerAgoraUid: null,  // Agora UID of the interviewer — derived server-side, sent in join ack
  candidateAgoraUid:   null,  // Agora UID of the candidate — derived server-side, sent in join ack

  // Lifecycle mirrors server MeetingStatus, plus two local states:
  //   idle        — no meeting, not in queue (initial / post-end)
  //   waiting     — candidate is in queue, or interviewer is browsing queue
  //   claimed     — interviewer claimed candidate; meeting created; candidate notified
  //   connecting  — candidate sent candidate_ready; both sides doing Agora setup
  //   active      — both peers in Agora channel; interview running
  //   interrupted — one side lost connection; grace window open
  //   ended       — meeting terminated; component should navigate away then call clearMeeting
  status: 'idle',

  // Candidate's currently-active video resume — { videoId, signedUrl, isApproved,
  // uploaderRole, uploaderName, uploadedAt, approvedBy, approvedAt } | null.
  activeVideo: null,
};

export const useMeetingStore = create((set) => ({
  ...initialState,

  // Called after socket connect, before any meeting exists.
  setWaiting: () => set({ status: 'waiting' }),

  // Called from join_room (interviewer) or candidate_ready (candidate) ack.
  // agoraToken is intentionally excluded — it is ephemeral and passed directly
  // to joinChannel() without being stored in global state.
  // interviewerName / candidateName are optional; omitting them leaves existing values.
  setMeetingJoined: ({ meetingId, agoraChannel, agoraUid, candidateId, interviewerId, interviewerName, candidateName, interviewerAgoraUid, candidateAgoraUid }) =>
    set((s) => ({
      meetingId,
      agoraChannel,
      agoraUid,
      candidateId,
      interviewerId,
      interviewerName:     interviewerName     !== undefined ? interviewerName     : s.interviewerName,
      candidateName:       candidateName       !== undefined ? candidateName       : s.candidateName,
      interviewerAgoraUid: interviewerAgoraUid !== undefined ? interviewerAgoraUid : s.interviewerAgoraUid,
      candidateAgoraUid:   candidateAgoraUid   !== undefined ? candidateAgoraUid   : s.candidateAgoraUid,
    })),

  // Single handler for all meeting_status socket events.
  // Does not clear fields when status becomes 'ended' — the component reads
  // status === 'ended' to show the end screen, then calls clearMeeting() itself.
  applyMeetingStatus: ({ meetingId, status }) =>
    set((state) => ({
      meetingId: meetingId ?? state.meetingId,
      status,
    })),

  // Optional — set when participant name data is available.
  setParticipantNames: ({ candidateName, interviewerName }) =>
    set((s) => ({
      candidateName:   candidateName   ?? s.candidateName,
      interviewerName: interviewerName ?? s.interviewerName,
    })),

  setActiveVideo: (payload) => set({ activeVideo: payload }),
  clearActiveVideo: () => set({ activeVideo: null }),

  // Full reset — call after navigating away from the ended meeting.
  clearMeeting: () => set(initialState),
}));
