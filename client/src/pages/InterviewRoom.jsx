import { useEffect, useState, useCallback, useRef, useMemo, startTransition } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore.js';
import { useMeetingStore } from '../store/useMeetingStore.js';
import { useTranscriptStore } from '../store/useTranscriptStore.js';
import { getSocket, getAttachedMeeting, clearAttachedMeeting } from '../hooks/useSocket.js';
import { API_URL } from '../config.js';
import { tokenStorage } from '../utils/tokenStorage.js';
import useAgora from '../hooks/useAgora.js';
import useTranscript from '../hooks/useTranscript.js';
import VideoGrid from '../components/VideoGrid.jsx';
import TranscriptBox from '../components/TranscriptBox.jsx';
import NotesPanel from '../components/NotesPanel.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import RoomControls from '../components/RoomControls.jsx';
import ParticipantPanel from '../components/ParticipantPanel.jsx';

const GRACE_SECONDS = 30;

export default function InterviewRoom() {
  const navigate              = useNavigate();
  const { state: locState }   = useLocation();
  const { roomId: meetingIdParam } = useParams();

  const user  = useAuthStore((s) => s.user);
  const role  = user?.role ?? 'candidate';

  const meetingId          = useMeetingStore((s) => s.meetingId);
  const agoraChannel       = useMeetingStore((s) => s.agoraChannel);
  const agoraUid           = useMeetingStore((s) => s.agoraUid);
  const candidateId        = useMeetingStore((s) => s.candidateId);
  const interviewerName    = useMeetingStore((s) => s.interviewerName);
  const candidateName      = useMeetingStore((s) => s.candidateName);
  const interviewerAgoraUid = useMeetingStore((s) => s.interviewerAgoraUid);
  const candidateAgoraUid  = useMeetingStore((s) => s.candidateAgoraUid);
  const clearMeeting       = useMeetingStore((s) => s.clearMeeting);
  const setMeetingJoined   = useMeetingStore((s) => s.setMeetingJoined);
  const applyMeetingStatus = useMeetingStore((s) => s.applyMeetingStatus);

  const addSegment          = useTranscriptStore((s) => s.addSegment);
  const setTranscriptionFailed = useTranscriptStore((s) => s.setTranscriptionFailed);
  const addNote             = useTranscriptStore((s) => s.addNote);
  const updateNote          = useTranscriptStore((s) => s.updateNote);
  const removeNote          = useTranscriptStore((s) => s.removeNote);
  const mergeCatchupData    = useTranscriptStore((s) => s.mergeCatchupData);
  const clearTranscript     = useTranscriptStore((s) => s.clearTranscript);

  const [historyOpened,         setHistoryOpened]         = useState(false);
  const [terminated,            setTerminated]            = useState(false);
  const [terminatedCountdown,   setTerminatedCountdown]   = useState(5);
  const [interrupted,           setInterrupted]           = useState(false);
  const [interruptedCountdown,  setInterruptedCountdown]  = useState(GRACE_SECONDS);
  const [connectionLost,        setConnectionLost]        = useState(false);
  const [activeTab,             setActiveTab]             = useState('transcript');
  const [agoraCredentials,      setAgoraCredentials]      = useState(locState ?? null);

  const interruptedTimerRef = useRef(null);

  const socketRole = role === 'interviewer' ? 'interviewer'
                   : role === 'supervisor'  ? 'supervisor'
                   : 'candidate';
  // getSocket creates a socket.io connection on first call — side effect that
  // must not repeat on every render. useState lazy initializer runs exactly once.
  const [socket] = useState(() => getSocket(socketRole));

  const {
    localVideoRef, localVideoTrack, localAudioTrack, remoteUsers,
    isMuted, isCameraOff,
    joinChannel, leaveChannel, toggleMute, toggleCamera,
  } = useAgora({ role, channelName: agoraChannel });

  // Transcript pipeline — candidate only
  useTranscript({
    localAudioTrack: role === 'candidate' ? localAudioTrack : null,
    socket:          role === 'candidate' ? socket : null,
    enabled:         role === 'candidate',
    paused:          isMuted,
  });

  const effectiveMeetingId = meetingId ?? meetingIdParam;

  const tabs = role === 'supervisor'
    ? [{ id: 'transcript', label: 'Transcript' }, { id: 'notes', label: 'Notes' }, { id: 'history', label: 'History' }]
    : [{ id: 'transcript', label: 'Transcript' }, { id: 'history', label: 'History' }];

  const uidToName = useMemo(() => {
    const map = {};
    // Exclude null/undefined UIDs — coercing null to the string 'null' produces a key
    // that never matches a numeric Agora UID and pollutes the lookup table.
    if (agoraUid != null)            map[agoraUid]            = user?.name ?? 'You';
    if (interviewerAgoraUid != null) map[interviewerAgoraUid] = interviewerName ?? 'Interviewer';
    if (candidateAgoraUid != null)   map[candidateAgoraUid]   = candidateName ?? 'Candidate';
    return map;
  }, [agoraUid, interviewerAgoraUid, candidateAgoraUid, interviewerName, candidateName, user?.name]);

  const hydrateMeeting = useCallback(async (attachedPayload = null) => {
    const targetMeetingId = attachedPayload?.meetingId ?? effectiveMeetingId;
    if (!targetMeetingId) return;

    const token = tokenStorage.get();
    if (!token) return;

    try {
      const lastSeq = useTranscriptStore
        .getState()
        .segments
        .reduce((max, seg) => Math.max(max, seg.seq ?? 0), 0);
      const [meetingRes, transcriptRes, notesRes] = await Promise.all([
        fetch(`${API_URL}/meetings/${targetMeetingId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/meetings/${targetMeetingId}/transcript?afterSeq=${lastSeq}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/meetings/${targetMeetingId}/notes`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!meetingRes.ok) return;
      const { meeting } = await meetingRes.json();
      const transcriptBody = transcriptRes.ok ? await transcriptRes.json() : { segments: [] };
      const notesBody = notesRes.ok ? await notesRes.json() : { notes: [] };

      startTransition(() => {
        setMeetingJoined({
          meetingId:           meeting.id,
          agoraChannel:        attachedPayload?.agoraChannel ?? meeting.agoraChannel,
          agoraUid:            attachedPayload?.uid ?? null,
          candidateId:         meeting.candidateId,
          interviewerId:       meeting.interviewerId,
          interviewerName:     meeting.interviewerName ?? null,
          candidateName:       meeting.candidateName ?? null,
          // API (MeetingDetailsWithNames) does not carry Agora UIDs.
          // Read from socket payload when present; undefined → store preserves existing value.
          interviewerAgoraUid: attachedPayload?.participantUids?.interviewerUid ?? undefined,
          candidateAgoraUid:   attachedPayload?.participantUids?.candidateUid   ?? undefined,
        });
        applyMeetingStatus({ meetingId: meeting.id, status: attachedPayload?.status ?? meeting.status });
        mergeCatchupData({ segments: transcriptBody.segments ?? [], notes: notesBody.notes ?? [] });
      });

      if (attachedPayload?.agoraToken && attachedPayload?.uid != null) {
        setAgoraCredentials({ agoraToken: attachedPayload.agoraToken, uid: attachedPayload.uid });
      }
    } catch (err) {
      console.warn('Meeting hydration failed:', err);
    }
  }, [effectiveMeetingId, setMeetingJoined, applyMeetingStatus, mergeCatchupData]);

  // Join Agora when credentials are available — joinChannel's internal guard prevents double-join
  useEffect(() => {
    const { agoraToken, uid } = agoraCredentials ?? {};
    if (agoraToken && uid != null && agoraChannel) joinChannel(agoraToken, uid);
  }, [agoraCredentials, agoraChannel, joinChannel]);

  // Socket events
  useEffect(() => {
    if (!socket) return;

    const onConnect    = () => {
      setConnectionLost(false);
      hydrateMeeting(getAttachedMeeting(socketRole));
    };
    const onDisconnect = () => setConnectionLost(true);

    const onMeetingAttached = (payload) => {
      hydrateMeeting(payload);
    };

    const onMeetingStatus = ({ meetingId, status, interviewerName: evtInterviewerName, participantUids }) => {
      // startTransition prevents these Zustand + local-state updates from landing
      // during an in-progress React 18 concurrent render, which is what triggers
      // "Cannot update a component while rendering a different component."
      startTransition(() => applyMeetingStatus({ meetingId, status }));

      if (status === 'ended') {
        clearInterval(interruptedTimerRef.current);
        startTransition(() => {
          setInterrupted(false);
          setTerminated(true);
        });
        // Clear session-storage attachment so CandidateWaitingRoom doesn't
        // bounce back to this ended meeting on the already-connected path.
        clearAttachedMeeting(socketRole);
      } else if (status === 'interrupted') {
        clearInterval(interruptedTimerRef.current);
        startTransition(() => {
          setInterrupted(true);
          setInterruptedCountdown(GRACE_SECONDS);
        });
        interruptedTimerRef.current = setInterval(() => {
          setInterruptedCountdown((c) => {
            if (c <= 1) {
              clearInterval(interruptedTimerRef.current);
              setInterrupted(false);
              setTerminated(true);
              return 0;
            }
            return c - 1;
          });
        }, 1000);
      } else if (status === 'active') {
        clearInterval(interruptedTimerRef.current);
        // When the interviewer first joins, the broadcast carries their name and
        // Agora UID so the candidate's video tile resolves immediately without a
        // round-trip hydrate.
        if (evtInterviewerName != null || participantUids?.interviewerUid != null) {
          const cur = useMeetingStore.getState();
          startTransition(() => setMeetingJoined({
            meetingId:           cur.meetingId,
            agoraChannel:        cur.agoraChannel,
            agoraUid:            cur.agoraUid,
            candidateId:         cur.candidateId,
            interviewerId:       cur.interviewerId,
            interviewerName:     evtInterviewerName,
            interviewerAgoraUid: participantUids?.interviewerUid,
            candidateAgoraUid:   participantUids?.candidateUid,
          }));
        }
        startTransition(() => setInterrupted(false));
      }
    };

    // Interviewer/supervisor receive transcript segments via socket;
    // candidate receives them through the useTranscript pipeline.
    const onTranscriptSegment = (segment) => {
      addSegment(segment);
    };

    const onTranscriptError = () => {
      setTranscriptionFailed(true);
    };

    const onNoteAdded   = (note)                  => addNote(note);
    const onNoteUpdated = ({ noteId, body, updatedAt }) => updateNote({ noteId, body, updatedAt });
    const onNoteDeleted = ({ noteId })             => removeNote(noteId);

    socket.on('connect',            onConnect);
    socket.on('disconnect',         onDisconnect);
    socket.on('meeting_attached',    onMeetingAttached);
    socket.on('meeting_status',     onMeetingStatus);
    socket.on('transcript_segment', onTranscriptSegment);
    socket.on('transcript_error',   onTranscriptError);
    socket.on('note_added',         onNoteAdded);
    socket.on('note_updated',       onNoteUpdated);
    socket.on('note_deleted',       onNoteDeleted);

    queueMicrotask(() => hydrateMeeting(getAttachedMeeting(socketRole)));

    return () => {
      socket.off('connect',            onConnect);
      socket.off('disconnect',         onDisconnect);
      socket.off('meeting_attached',    onMeetingAttached);
      socket.off('meeting_status',     onMeetingStatus);
      socket.off('transcript_segment', onTranscriptSegment);
      socket.off('transcript_error',   onTranscriptError);
      socket.off('note_added',         onNoteAdded);
      socket.off('note_updated',       onNoteUpdated);
      socket.off('note_deleted',       onNoteDeleted);
    };
  }, [socket, role, socketRole, applyMeetingStatus, setMeetingJoined, addSegment, setTranscriptionFailed, addNote, updateNote, removeNote, hydrateMeeting]);

  // Terminated countdown → redirect
  useEffect(() => {
    if (!terminated) return;
    const timer = setInterval(() => {
      setTerminatedCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          clearMeeting();
          clearTranscript();
          if (role === 'interviewer') {
            clearAttachedMeeting('interviewer');
            navigate('/interviewer');
          } else if (role === 'supervisor') navigate('/supervisor');
          else {
            clearAttachedMeeting('candidate');
            navigate('/candidate');
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [terminated, role, navigate, clearMeeting, clearTranscript]);

  // Clear interrupted timer on unmount
  useEffect(() => () => clearInterval(interruptedTimerRef.current), []);

  const handleEndCall = useCallback(async () => {
    if (role === 'interviewer') {
      socket.emit('end_meeting', { meetingId: meetingId ?? meetingIdParam, reason: 'interviewer_ended' });
    }
    await leaveChannel();
    clearMeeting();
    clearTranscript();
    if (role === 'interviewer') {
      clearAttachedMeeting('interviewer');
      navigate('/interviewer');
    } else if (role === 'supervisor') navigate('/supervisor');
    else navigate('/candidate');
  }, [role, socket, meetingId, meetingIdParam, leaveChannel, clearMeeting, clearTranscript, navigate]);

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Connection lost banner */}
      {connectionLost && (
        <div className="bg-warning-500/20 border-b border-warning-500/30 px-4 py-2 text-center flex-shrink-0">
          <span className="text-warning-400 text-sm font-medium">
            Connection lost — reconnecting…
          </span>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-surface-800 bg-surface-950/80 backdrop-blur-lg z-30 flex-shrink-0">
        <div className="max-w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h1 className="text-base font-bold text-surface-50">RecruitMonitor</h1>
          </div>
          <div className="flex items-center gap-4">
            {role === 'supervisor' && (
              <span className="text-xs bg-primary-500/10 text-primary-400 px-3 py-1 rounded-lg font-medium">
                Monitoring Mode
              </span>
            )}
            {effectiveMeetingId && (
              <span className="font-mono text-xs text-surface-500">
                {effectiveMeetingId.slice(0, 8)}…
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video + participant panel — 60% */}
        <div className="flex-[3] flex flex-col p-4 gap-4 overflow-hidden">
          <div className="flex-1 rounded-2xl overflow-hidden">
            <VideoGrid
              role={role}
              localVideoRef={localVideoRef}
              localVideoTrack={localVideoTrack}
              remoteUsers={remoteUsers}
              isMuted={isMuted}
              isCameraOff={isCameraOff}
              localName={user?.name ?? 'You'}
              uidToName={uidToName}
            />
          </div>
          <ParticipantPanel
            interviewerName={interviewerName ?? (role === 'interviewer' ? user?.name : null)}
            candidateName={candidateName ?? (role === 'candidate' ? user?.name : null)}
          />
        </div>

        {/* Right sidebar — 40% */}
        <div className="flex-[2] border-l border-surface-800 bg-surface-900/50 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-surface-700/50 flex-shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'history') setHistoryOpened(true);
                }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? 'text-primary-400 border-primary-400'
                    : 'text-surface-400 border-transparent hover:text-surface-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'transcript' && (
              <TranscriptBox
                socket={socket}
                meetingId={effectiveMeetingId}
                readOnly={role === 'supervisor'}
              />
            )}
            {activeTab === 'notes' && (
              <NotesPanel
                socket={role !== 'supervisor' ? socket : null}
                meetingId={effectiveMeetingId}
              />
            )}
            {/* History panel mounts on first open and stays mounted to preserve scroll/state */}
            <div className={activeTab !== 'history' ? 'hidden' : 'h-full overflow-hidden'}>
              {historyOpened && <HistoryPanel candidateId={candidateId} role={role} />}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <RoomControls
        role={role}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onEndCall={handleEndCall}
      />

      {/* Interrupted overlay — sits below terminated so terminated takes priority */}
      {interrupted && !terminated && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-surface-950/60 backdrop-blur-sm animate-fade-in">
          <div className="glass-card p-8 text-center max-w-sm w-full mx-4">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-warning-500/10 border border-warning-500/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-50 mb-2">Connection Interrupted</h2>
            <p className="text-surface-400 text-sm mb-4">
              A participant lost connection. Waiting for them to reconnect…
            </p>
            <p className="text-surface-500 text-sm">
              Session ends in{' '}
              <span className="text-warning-400 font-mono font-semibold">{interruptedCountdown}s</span>
            </p>
          </div>
        </div>
      )}

      {/* Terminated overlay */}
      {terminated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 backdrop-blur-md animate-fade-in">
          <div className="glass-card p-10 text-center max-w-md w-full mx-4 animate-slide-up">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-500/10 border border-danger-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M1.5 4.5l21 15" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-surface-50 mb-2">Interview Ended</h2>
            <p className="text-surface-400 mb-6">This session has concluded.</p>
            <p className="text-surface-500 text-sm">
              Redirecting in {terminatedCountdown} second{terminatedCountdown !== 1 ? 's' : ''}…
            </p>
            <div className="flex justify-center gap-1 mt-4">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < 5 - terminatedCountdown ? 'bg-primary-400' : 'bg-surface-600'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
