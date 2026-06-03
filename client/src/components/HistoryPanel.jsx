import { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../config.js';
import { tokenStorage } from '../utils/tokenStorage.js';

function Spinner() {
  return (
    <div className="flex justify-center py-6">
      <svg className="animate-spin w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function HistoryPanel({ candidateId, role }) {
  const [loading,      setLoading]      = useState(true);
  const [history,      setHistory]      = useState([]);
  const [fetchError,   setFetchError]   = useState(false);
  const [expandedId,   setExpandedId]   = useState(null);
  const [expandedData, setExpandedData] = useState({}); // { [meetingId]: { loading, segments, notes, error } }
  const fetchedRef = useRef(new Set());

  // candidateId and token are always present when this component mounts —
  // the guards are safety nets, not normal paths, so no setState needed there.
  useEffect(() => {
    if (!candidateId) return;
    const token = tokenStorage.get();
    if (!token) return;

    fetch(`${API_URL}/candidates/${candidateId}/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(({ history: h }) => setHistory(h ?? []))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [candidateId]);

  const handleToggle = useCallback(async (meetingId) => {
    setExpandedId((prev) => (prev === meetingId ? null : meetingId));

    if (fetchedRef.current.has(meetingId)) return;
    fetchedRef.current.add(meetingId);

    setExpandedData((prev) => ({
      ...prev,
      [meetingId]: { loading: true, segments: [], notes: [] },
    }));

    const token = tokenStorage.get();
    if (!token) {
      setExpandedData((prev) => ({
        ...prev,
        [meetingId]: { loading: false, segments: [], notes: [], error: true },
      }));
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };
    const base = `${API_URL}/candidates/${candidateId}/history/${meetingId}`;

    try {
      const [transcriptRes, notesRes] = await Promise.all([
        fetch(`${base}/transcript`, { headers }).then((r) => r.json()),
        role !== 'candidate'
          ? fetch(`${base}/notes`, { headers }).then((r) => r.json())
          : Promise.resolve({ notes: [] }),
      ]);
      setExpandedData((prev) => ({
        ...prev,
        [meetingId]: {
          loading:  false,
          segments: transcriptRes?.segments ?? [],
          notes:    notesRes?.notes ?? [],
        },
      }));
    } catch {
      setExpandedData((prev) => ({
        ...prev,
        [meetingId]: { loading: false, segments: [], notes: [], error: true },
      }));
    }
  }, [candidateId, role]);

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-6 text-center">
        <p className="text-danger-400 text-sm">Failed to load interview history.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-surface-700/50 flex-shrink-0">
        <svg className="w-4 h-4 text-primary-400 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-semibold text-surface-200">
          {history.length === 0
            ? 'No prior interviews'
            : `${history.length} prior interview${history.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Empty state */}
      {history.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-800 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-surface-400 text-sm font-medium">No prior interviews</p>
          <p className="text-surface-500 text-xs mt-1">This is their first interview on the platform.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {history.map((item) => {
            const isExpanded = expandedId === item.meetingId;
            const data       = expandedData[item.meetingId];

            return (
              <div key={item.meetingId} className="bg-surface-800/50 rounded-xl overflow-hidden">
                {/* Collapsed row / toggle header */}
                <button
                  onClick={() => handleToggle(item.meetingId)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-700/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-surface-100 text-sm font-medium">{formatDate(item.startedAt)}</span>
                    <svg
                      className={`w-4 h-4 text-surface-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <p className="text-surface-400 text-xs mb-1.5 truncate">{item.interviewerName}</p>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-surface-500">
                    <span>{item.durationMinutes} min</span>
                    <span>·</span>
                    <span>{item.segmentCount} segments</span>
                    {role !== 'candidate' && item.noteCount > 0 && (
                      <>
                        <span>·</span>
                        <span>{item.noteCount} note{item.noteCount !== 1 ? 's' : ''}</span>
                      </>
                    )}
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-surface-700/50">
                    {!data || data.loading ? (
                      <Spinner />
                    ) : data.error ? (
                      <p className="text-danger-400 text-xs px-4 py-3">Failed to load content.</p>
                    ) : (
                      <div className="max-h-72 overflow-y-auto">
                        {/* Transcript segments (final only) */}
                        {data.segments.filter((s) => s.isFinal).length === 0 ? (
                          <p className="text-surface-500 text-xs px-4 py-3 italic">No transcript available.</p>
                        ) : (
                          <div className="px-3 py-2 space-y-1.5">
                            {data.segments.filter((s) => s.isFinal).map((seg) => (
                              <div key={seg.id} className="flex gap-2 min-w-0">
                                <span className={`text-xs font-semibold flex-shrink-0 mt-0.5 w-12 ${
                                  seg.speakerRole === 'candidate'
                                    ? 'text-primary-400'
                                    : 'text-success-400'
                                }`}>
                                  {seg.speakerRole === 'candidate' ? 'Cand.' : 'Int.'}
                                </span>
                                <p className="text-surface-200 text-xs leading-relaxed">{seg.text}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Notes — interviewers and supervisors only */}
                        {role !== 'candidate' && data.notes.length > 0 && (
                          <>
                            <div className="px-4 pt-2 pb-1 border-t border-surface-700/30">
                              <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
                                Notes
                              </span>
                            </div>
                            <div className="px-3 pb-2 space-y-1.5">
                              {data.notes.map((note) => (
                                <div key={note.id} className="bg-surface-700/30 rounded-lg px-3 py-2">
                                  <p className="text-surface-200 text-xs leading-relaxed whitespace-pre-wrap">{note.body}</p>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
