import { useRef, useEffect, useCallback, useState } from 'react';
import { useTranscriptStore } from '../store/useTranscriptStore.js';

function PencilIcon() {
  return (
    <svg className="w-3 h-3 text-surface-400 flex-shrink-0 mt-0.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function EditableSegment({ segment, note, socket, meetingId }) {
  const elRef = useRef(null);
  // Capture initial display text so the mount effect has no declared deps
  const initialTextRef = useRef(note?.body ?? segment.text);

  useEffect(() => {
    if (elRef.current) elRef.current.innerText = initialTextRef.current;
  }, []);

  // Sync remote edits while not actively typing
  useEffect(() => {
    const el = elRef.current;
    if (!el || document.activeElement === el) return;
    const text = note?.body ?? segment.text;
    if (el.innerText !== text) el.innerText = text;
  }, [note?.body, segment.text]);

  const handleBlur = useCallback(() => {
    const el = elRef.current;
    if (!el || !socket || !meetingId) return;
    const newText = el.innerText.trim();
    const currentText = note?.body ?? segment.text;
    if (newText === currentText) return;
    if (!newText) {
      el.innerText = currentText;
      return;
    }
    if (note) {
      socket.emit('update_note', { meetingId, noteId: note.id, body: newText });
    } else {
      socket.emit('add_note', { meetingId, body: newText, anchorSegmentId: segment.id });
    }
  }, [note, segment, socket, meetingId]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      elRef.current?.blur();
    }
    if (e.key === 'Escape') {
      if (elRef.current) elRef.current.innerText = note?.body ?? segment.text;
      elRef.current?.blur();
    }
  }, [note, segment.text]);

  return (
    <div className="group flex items-start gap-1.5">
      <p
        ref={elRef}
        contentEditable
        suppressContentEditableWarning
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        title="Click to edit"
        className={`flex-1 text-surface-200 text-sm leading-relaxed whitespace-pre-wrap rounded px-1 -mx-1
          focus:outline-none focus:bg-surface-800/50 focus:ring-1 focus:ring-primary-500/30
          hover:bg-surface-800/20 transition-colors cursor-text
          ${note ? 'underline decoration-dotted decoration-surface-500 underline-offset-2' : ''}
        `}
      />
      {note && <PencilIcon />}
    </div>
  );
}

export default function TranscriptBox({ socket, meetingId, readOnly = false }) {
  const segments            = useTranscriptStore((s) => s.segments);
  const interimSegment      = useTranscriptStore((s) => s.interimSegment);
  const transcriptionFailed = useTranscriptStore((s) => s.transcriptionFailed);
  const notes               = useTranscriptStore((s) => s.notes);
  const containerRef        = useRef(null);
  const [appendDraft, setAppendDraft] = useState('');

  const notesBySegmentId = {};
  for (const n of notes) {
    if (n.anchorSegmentId != null) notesBySegmentId[n.anchorSegmentId] = n;
  }
  const freeNotes = notes.filter((n) => n.anchorSegmentId == null);

  useEffect(() => {
    if (containerRef.current)
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [segments, interimSegment, freeNotes.length]);

  const handleAppend = useCallback(() => {
    const body = appendDraft.trim();
    if (!body || !socket || !meetingId) return;
    socket.emit('add_note', { meetingId, body, anchorSegmentId: null }, (ack) => {
      if (ack?.ok) setAppendDraft('');
    });
  }, [appendDraft, socket, meetingId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-sm font-semibold text-surface-200">Transcript</span>
        </div>
        {transcriptionFailed && (
          <span className="text-xs text-warning-400 bg-warning-400/10 px-2 py-1 rounded-lg">Unavailable</span>
        )}
      </div>

      <div ref={containerRef} className="flex-1 p-4 overflow-y-auto space-y-1.5">
        {segments.length === 0 && !interimSegment ? (
          <p className="text-surface-600 text-sm italic">
            Transcript will appear here when the candidate speaks…
          </p>
        ) : (
          segments.map((seg) => {
            const note = notesBySegmentId[seg.id] ?? null;
            if (readOnly) {
              return (
                <p key={seg.id} className="text-surface-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {note ? note.body : seg.text}
                </p>
              );
            }
            return (
              <EditableSegment
                key={seg.id}
                segment={seg}
                note={note}
                socket={socket}
                meetingId={meetingId}
              />
            );
          })
        )}
        {interimSegment && (
          <p className="text-surface-400 text-sm leading-relaxed italic opacity-70">
            {interimSegment.text}
          </p>
        )}
        {freeNotes.map((note) => (
          <p key={note.id} className="text-surface-300 text-sm leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-primary-500/30">
            {note.body}
          </p>
        ))}
      </div>

      {!readOnly && (
        <div className="p-3 border-t border-surface-700/50 flex-shrink-0">
          <div className="flex gap-2">
            <input
              type="text"
              value={appendDraft}
              onChange={(e) => setAppendDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAppend(); }}
              placeholder="Add note…"
              className="flex-1 bg-surface-800/50 border border-surface-700/50 text-surface-200 text-sm rounded-xl px-3 py-1.5 focus:outline-none focus:border-primary-500/50 placeholder:text-surface-600"
            />
            <button
              onClick={handleAppend}
              disabled={!appendDraft.trim()}
              className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
