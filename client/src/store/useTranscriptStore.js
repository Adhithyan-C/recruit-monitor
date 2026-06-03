import { create } from 'zustand';

// SegmentRow shape (mirrors server TranscriptService.SegmentRow):
//   { id, meetingId, seq, speakerUserId, speakerRole, text,
//     startedAt, endedAt, isFinal, confidence, createdAt }
//
// NoteRow shape (mirrors server TranscriptService.NoteRow):
//   { id, meetingId, anchorSegmentId, authorUserId, body, createdAt, updatedAt }

const initialState = {
  segments:           [],    // SegmentRow[] — ordered by seq, finals only
  interimSegment:     null,  // { text: string } | null — live partial, not persisted
  notes:              [],    // NoteRow[] — ordered by createdAt
  transcriptionFailed: false,
};

export const useTranscriptStore = create((set) => ({
  ...initialState,

  // Appends a final segment. Deduplicates by id in case the supervisor's
  // join_room catchup and a live broadcast arrive for the same segment.
  addSegment: (segment) =>
    set((s) => {
      if (s.segments.some((seg) => seg.id === segment.id)) return s;
      return { segments: [...s.segments, segment] };
    }),

  // Sets or clears the in-progress partial. Null clears it (e.g. on disconnect).
  setInterimSegment: (partial) => set({ interimSegment: partial }),

  // Bulk-loads segments and notes from a join_room ack or HTTP history fetch.
  // Replaces existing data — intended for initial load, not incremental updates.
  setInitialData: ({ segments, notes }) => set({ segments, notes }),

  mergeCatchupData: ({ segments = [], notes = [] }) =>
    set((s) => {
      const segmentById = new Map(s.segments.map((seg) => [seg.id, seg]));
      for (const segment of segments) segmentById.set(segment.id, segment);

      const noteById = new Map(s.notes.map((note) => [note.id, note]));
      for (const note of notes) noteById.set(note.id, note);

      return {
        segments: Array.from(segmentById.values()).sort((a, b) => a.seq - b.seq),
        notes: Array.from(noteById.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      };
    }),

  // ── Note actions ──────────────────────────────────────────────────────

  addNote: (note) =>
    set((s) => {
      if (s.notes.some((n) => n.id === note.id)) return s;
      return { notes: [...s.notes, note] };
    }),

  updateNote: ({ noteId, body, updatedAt }) =>
    set((s) => ({
      notes: s.notes.map((n) =>
        n.id === noteId ? { ...n, body, updatedAt } : n,
      ),
    })),

  removeNote: (noteId) =>
    set((s) => ({ notes: s.notes.filter((n) => n.id !== noteId) })),

  // ── Error state ───────────────────────────────────────────────────────

  setTranscriptionFailed: (failed) => set({ transcriptionFailed: failed }),

  // Full reset — call after clearMeeting().
  clearTranscript: () => set(initialState),
}));
