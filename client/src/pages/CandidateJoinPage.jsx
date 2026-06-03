import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomStore } from '../store/useRoomStore.js';
import { useTranscriptStore } from '../store/useTranscriptStore.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { getSocket } from '../hooks/useSocket.js';

export default function CandidateJoinPage() {
  const navigate        = useNavigate();
  const setRoom         = useRoomStore((s) => s.setRoom);
  const setUserRole     = useRoomStore((s) => s.setUserRole);
  const setCandidateName = useRoomStore((s) => s.setCandidateName);
  const setText         = useTranscriptStore((s) => s.setText);
  const authUser        = useAuthStore((s) => s.user);
  const isAuthCandidate = authUser?.role === 'candidate';

  const [name,    setName]    = useState(isAuthCandidate && authUser?.name ? authUser.name : '');
  const [code,    setCode]    = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const handleCodeChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(val);
  };

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    if (!name.trim() || code.length !== 6) return;
    setError('');
    setLoading(true);

    const socket = getSocket('candidate');

    const handleConfirmed = ({ roomId, rtcChannelName, transcriptText }) => {
      setRoom({ roomId, roomCode: code, rtcChannelName });
      setUserRole('candidate');
      setCandidateName(name.trim());
      if (transcriptText) setText(transcriptText);
      socket.off('room:candidate-confirmed', handleConfirmed);
      socket.off('error:room', handleError);
      navigate(`/room/${roomId}`);
    };

    const handleError = ({ message }) => {
      setError(message);
      setLoading(false);
      socket.off('room:candidate-confirmed', handleConfirmed);
      socket.off('error:room', handleError);
    };

    socket.on('room:candidate-confirmed', handleConfirmed);
    socket.on('error:room', handleError);
    socket.emit('candidate:join', { roomCode: code, candidateName: name.trim() });
  }, [name, code, navigate, setRoom, setUserRole, setCandidateName, setText]);

  return (
    <div className="flex-1 flex flex-col sm:items-center sm:justify-center sm:px-4 sm:py-8">
      <div className="w-full sm:max-w-md animate-fade-in">

        {/* Logo + title */}
        <div className="text-center px-6 pt-10 pb-6 sm:px-0 sm:pt-0 sm:pb-0 sm:mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-md bg-primary-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-surface-50 mb-1.5">Join Interview</h1>
          <p className="text-sm text-surface-400">Enter the room code provided by your interviewer</p>
        </div>

        {/* Card — edge-to-edge on mobile */}
        <div className="glass-card rounded-none sm:rounded-lg p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="candidate-name" className="block text-sm font-medium text-surface-300 mb-1.5">
                Your Name
              </label>
              <input
                id="candidate-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                className="glass-input"
                disabled={loading}
              />
            </div>

            <div>
              <label htmlFor="room-code" className="block text-sm font-medium text-surface-300 mb-1.5">
                Room Code
              </label>
              <input
                id="room-code"
                type="text"
                value={code}
                onChange={handleCodeChange}
                placeholder="ABCD12"
                className="glass-input font-mono text-center text-2xl tracking-[0.2em] uppercase"
                maxLength={6}
                disabled={loading}
              />
              {error && (
                <div className="mt-2.5 flex items-center gap-2 px-3 py-2.5 rounded-md bg-danger-500/10 border border-danger-500/20 text-danger-400 text-sm animate-fade-in">
                  <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !name.trim() || code.length !== 6}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
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
          </form>
        </div>

        {/* Footer */}
        <div className="text-center px-6 py-5 sm:px-0 sm:mt-5">
          <p className="text-surface-400 text-sm">
            Are you an interviewer?{' '}
            <a href="/" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Sign in →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
