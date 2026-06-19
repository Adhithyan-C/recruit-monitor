import { useEffect } from 'react';

export default function ApproveVideoModal({ isOpen, onConfirm, onCancel }) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-surface-900 border border-surface-700 rounded-lg w-full max-w-md mx-4 animate-slide-up shadow-xl">
        <div className="px-6 py-4 border-b border-surface-700/50">
          <h2 className="text-surface-50 font-semibold">Approve this video?</h2>
        </div>

        <div className="px-6 py-4">
          <p className="text-surface-300 text-sm">
            Once approved, this becomes the candidate's permanent video. Neither
            you nor the candidate will be able to upload or record any more
            videos for this candidate in any future meeting. This action cannot
            be undone.
          </p>
        </div>

        <div className="px-6 py-4 border-t border-surface-700/50 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="py-2 px-4 rounded-xl border border-surface-700 text-surface-300 text-sm hover:border-surface-600 hover:text-surface-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="py-2 px-4 rounded-xl bg-danger-500 hover:bg-danger-600 text-white text-sm font-medium transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
