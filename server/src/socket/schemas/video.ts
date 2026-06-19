import { z } from 'zod';

const uuid = z.string().uuid();

export const shareVideoSchema = z.object({
  meetingId: uuid,
  videoId:   uuid,
});

export const videoSyncSchema = z.object({
  meetingId:   uuid,
  videoId:     uuid,
  currentTime: z.number().nonnegative().finite(),
});

export const approveVideoSchema = z.object({
  meetingId: uuid,
  videoId:   uuid,
});
