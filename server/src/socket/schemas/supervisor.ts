import { z } from 'zod';

export const joinRoomSchema = z.object({
  meetingId: z.string().uuid(),
});
