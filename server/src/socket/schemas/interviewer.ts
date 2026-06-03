import { z } from 'zod';

const uuid = z.string().uuid();
const noteBody = z.string().min(1).max(2000);

// subscribe_open_rooms carries no payload — ack-only event.
export const subscribeOpenRoomsSchema = z.undefined();

export const joinOpenMeetingSchema = z.object({
  meetingId: uuid,
});

export const joinRoomSchema = z.object({
  meetingId: uuid,
});

export const endMeetingSchema = z.object({
  meetingId: uuid,
  reason: z.enum([
    'interviewer_ended',
    'candidate_left',
    'grace_expired',
    'claim_expired',
    'admin_terminated',
    'error',
  ]),
});

export const addNoteSchema = z.object({
  meetingId:        uuid,
  anchorSegmentId:  uuid.nullable().optional(),
  body:             noteBody,
});

export const updateNoteSchema = z.object({
  meetingId: uuid,
  noteId:    uuid,
  body:      noteBody,
});

export const deleteNoteSchema = z.object({
  meetingId: uuid,
  noteId:    uuid,
});
