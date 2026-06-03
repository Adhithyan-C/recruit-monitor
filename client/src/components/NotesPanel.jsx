import { useState, useCallback } from 'react';
import { useTranscriptStore } from '../store/useTranscriptStore.js';

export default function NotesPanel({ socket, meetingId }) {
  const notes      = useTranscriptStore((s) => s.notes);

  const [draft,     setDraft]     = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody,  setEditBody]  = useState('');

  const handleAdd = useCallback(() => {
    const body = draft.trim();
    if (!body || !socket || !meetingId) return;
    socket.emit('add_note', { meetingId, body }, (ack) => {
      if (ack.ok) {
        setDraft('');
      }
    });
  }, [draft, socket, meetingId]);

  const startEdit = useCallback((note) => {
    setEditingId(note.id);
    setEditBody(note.body);
  }, []);

  const handleSaveEdit = useCallback(() => {
    const body = editBody.trim();
    if (!body || !socket || !meetingId) return;
    socket.emit('update_note', { meetingId, noteId: editingId, body }, (ack) => {
      if (ack.ok) {
        setEditingId(null);
        setEditBody('');
      }
    });
  }, [editingId, editBody, socket, meetingId]);

  const handleDelete = useCallback((noteId) => {
    if (!socket || !meetingId) return;
    socket.emit('delete_note', { meetingId, noteId }, () => {
      // store update handled by broadcast
    });
  }, [socket, meetingId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 py-3 border-b border-surface-700/50 flex-shrink-0">
        <svg className="w-4 h-4 text-primary-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span className="text-sm font-semibold text-surface-200">Notes</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notes.length === 0 ? (
          <p className="text-surface-600 text-sm italic">Add notes about this interview…</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="group bg-surface-800/50 rounded-xl p-3">
              {editingId === note.id ? (
                <div className="space-y-2">
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); } }}
                    className="w-full bg-surface-700/50 text-surface-200 text-sm rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary-500"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} className="btn-primary text-xs px-3 py-1">Save</button>
                    <button onClick={() => setEditingId(null)} className="btn-secondary text-xs px-3 py-1">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-surface-200 text-sm leading-relaxed flex-1 whitespace-pre-wrap">{note.body}</p>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => startEdit(note)}
                      className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
                      title="Edit"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(note.id)}
                      className="p-1 text-surface-400 hover:text-danger-400 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add note */}
      <div className="p-4 border-t border-surface-700/50 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Add a note…"
            className="flex-1 bg-surface-800/50 border border-surface-700/50 text-surface-200 text-sm rounded-xl px-3 py-2 focus:outline-none focus:border-primary-500/50 placeholder:text-surface-600"
          />
          <button
            onClick={handleAdd}
            disabled={!draft.trim()}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
