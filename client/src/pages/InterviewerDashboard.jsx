import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore.js';
import { useMeetingStore } from '../store/useMeetingStore.js';
import { getSocket, disconnectAll, getAttachedMeeting } from '../hooks/useSocket.js';
import CandidateHistoryModal from '../components/CandidateHistoryModal.jsx';

export default function InterviewerDashboard() {
  const navigate         = useNavigate();
  const user             = useAuthStore((s) => s.user);
  const logout           = useAuthStore((s) => s.logout);
  const setMeetingJoined = useMeetingStore((s) => s.setMeetingJoined);

  const [openRooms,     setOpenRooms]     = useState([]);
  const [joiningId,     setJoiningId]     = useState(null);
  const [isConnected,   setIsConnected]   = useState(false);
  const [error,         setError]         = useState('');
  const [historyTarget, setHistoryTarget] = useState(null);
  const [now,           setNow]           = useState(Date.now);

  const handleCloseHistory = useCallback(() => setHistoryTarget(null), []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = getSocket('interviewer');

    const subscribeOpenRooms = () => {
      socket.emit('subscribe_open_rooms', (ack) => {
        if (ack.ok) setOpenRooms(ack.data.meetings);
      });
    };

    const onConnect    = () => { setIsConnected(true); subscribeOpenRooms(); };
    const onDisconnect = () => setIsConnected(false);

    const onOpenRoomsUpdate = ({ meetings }) => setOpenRooms(meetings);

    const onMeetingAttached = (payload) => {
      if (!payload?.meetingId) return;
      setMeetingJoined({
        meetingId:           payload.meetingId,
        agoraChannel:        payload.agoraChannel,
        agoraUid:            payload.uid,
        interviewerId:       payload.interviewerId ?? user?.userId ?? null,
        candidateId:         payload.candidateId ?? null,
        interviewerAgoraUid: payload.participantUids?.interviewerUid ?? null,
        candidateAgoraUid:   payload.participantUids?.candidateUid ?? null,
        interviewerName:     user?.name ?? null,
      });
      navigate(`/room/${payload.meetingId}`, {
        state: { agoraToken: payload.agoraToken, uid: payload.uid },
      });
    };

    socket.on('connect',           onConnect);
    socket.on('disconnect',        onDisconnect);
    socket.on('open_rooms_update', onOpenRoomsUpdate);
    socket.on('meeting_attached',  onMeetingAttached);

    subscribeOpenRooms();
    const attached = getAttachedMeeting('interviewer');
    if (attached) onMeetingAttached(attached);

    return () => {
      socket.off('connect',           onConnect);
      socket.off('disconnect',        onDisconnect);
      socket.off('open_rooms_update', onOpenRoomsUpdate);
      socket.off('meeting_attached',  onMeetingAttached);
    };
  }, [navigate, setMeetingJoined, user?.userId, user?.name]);

  const handleJoin = useCallback((meetingId) => {
    if (joiningId) return;
    const socket = getSocket('interviewer');
    setJoiningId(meetingId);
    setError('');

    socket.emit('join_open_meeting', { meetingId }, (ack) => {
      if (!ack.ok) {
        setError(
          ack.code === 'CONFLICT'
            ? 'That room is no longer available.'
            : ack.error || 'Failed to join the room.',
        );
      }
      setJoiningId(null);
    });
  }, [joiningId]);

  const handleLogout = useCallback(() => {
    disconnectAll();
    logout();
    navigate('/');
  }, [logout, navigate]);

  return (
    <div className="flex-1 flex flex-col">
      {historyTarget && (
        <CandidateHistoryModal
          candidateId={historyTarget.candidateId}
          candidateName={historyTarget.candidateName}
          onClose={handleCloseHistory}
        />
      )}

      {/* Header */}
      <header className="border-b border-surface-800 bg-surface-950 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-md bg-primary-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-surface-50 leading-tight">RecruitMonitor</h1>
              <p className="text-xs text-surface-500 hidden sm:block">
                Interviewer Dashboard · Showing {user?.language ? user.language.charAt(0).toUpperCase() + user.language.slice(1) : 'English'} rooms
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Connection dot — always visible */}
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success-400' : 'bg-surface-600 animate-pulse'}`} />
              <span className="text-xs text-surface-400 hidden sm:inline">
                {isConnected ? 'Connected' : 'Connecting…'}
              </span>
            </div>
            {/* User name — hidden on mobile */}
            <span className="hidden sm:inline text-sm font-medium text-surface-100">{user?.name}</span>
            <button onClick={handleLogout} className="btn-secondary text-sm px-3 sm:px-4 py-1.5 sm:py-2">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-surface-50">Open Rooms</h2>
            <p className="text-sm text-surface-400 mt-0.5">
              {openRooms.length === 0
                ? 'No candidates waiting'
                : `${openRooms.length} candidate${openRooms.length === 1 ? '' : 's'} waiting`}
            </p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 flex items-center gap-3 px-3 py-2.5 rounded-md bg-danger-500/10 border border-danger-500/20 text-danger-400 text-sm animate-fade-in">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError('')}
              aria-label="Close"
              className="p-0.5 text-surface-500 hover:text-surface-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Room list */}
        {openRooms.length === 0 ? (
          <div className="glass-card p-10 sm:p-16 text-center animate-fade-in">
            <div className="w-14 h-14 mx-auto mb-4 rounded-lg bg-surface-800 border border-surface-700 flex items-center justify-center">
              <svg className="w-7 h-7 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-surface-300 font-medium">No open rooms</p>
            <p className="text-surface-500 text-sm mt-1">Candidates will appear here when they connect.</p>
          </div>
        ) : (
          <ul className="space-y-2.5 animate-fade-in">
            {openRooms.map((room) => {
              const isJoining         = joiningId === room.id;
              const anyJoinInProgress = joiningId !== null;
              const waitMins  = Math.floor((now - new Date(room.createdAt).getTime()) / 60_000);
              const waitLabel = waitMins < 1 ? '<1 min' : `${waitMins} min`;

              return (
                <li key={room.id} className="glass-card p-4 sm:px-6 sm:py-4">
                  {/* Mobile: stack vertically. sm+: single horizontal row. */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">

                    {/* Left: avatar + name + badges */}
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-surface-800 border border-surface-700 flex items-center justify-center flex-shrink-0 mt-0.5 sm:mt-0">
                        <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-surface-100 font-medium truncate">
                          {room.candidateName || room.candidateId.slice(0, 8)}
                        </p>
                        {/* Wait badge + history — visible on mobile */}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs text-success-400 bg-success-400/10 border border-success-400/20 px-2 py-0.5 rounded font-medium">
                            waiting {waitLabel}
                          </span>
                          <button
                            onClick={() => setHistoryTarget({ candidateId: room.candidateId, candidateName: room.candidateName })}
                            className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
                          >
                            View history
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Join button — full width on mobile */}
                    <button
                      onClick={() => handleJoin(room.id)}
                      disabled={anyJoinInProgress}
                      className="btn-primary text-sm px-5 py-2 w-full sm:w-auto flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                    >
                      {isJoining ? (
                        <>
                          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Joining…
                        </>
                      ) : (
                        'Join Interview'
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
