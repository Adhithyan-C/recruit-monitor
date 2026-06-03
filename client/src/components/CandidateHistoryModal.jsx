import { useEffect } from 'react';
import HistoryPanel from './HistoryPanel.jsx';

export default function CandidateHistoryModal({ candidateId, candidateName, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface-900 border border-surface-800 rounded-lg w-full max-w-lg mx-4 max-h-[80vh] flex flex-col animate-slide-up shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/50 flex-shrink-0">
          <div>
            <h2 className="text-surface-50 font-semibold">Interview History</h2>
            {candidateName && (
              <p className="text-surface-400 text-sm mt-0.5">{candidateName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-200 transition-colors p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <HistoryPanel candidateId={candidateId} role="interviewer" />
        </div>
      </div>
    </div>
  );
}
