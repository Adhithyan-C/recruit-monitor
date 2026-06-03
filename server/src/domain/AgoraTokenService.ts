import { createHash } from 'crypto';
import { createRequire } from 'module';
import type * as AgoraTokenModule from 'agora-token';
// agora-token is CJS-only; named ESM imports fail at runtime under NodeNext.
const { RtcTokenBuilder, RtcRole } = createRequire(import.meta.url)('agora-token') as
  typeof AgoraTokenModule;

export interface AgoraTokenServiceDeps {
  appId: string;
  appCertificate: string;
  tokenTtlSeconds: number;
}

export type AgoraParticipantRole = 'publisher' | 'subscriber';

export interface GenerateTokenParams {
  channelName: string;
  uid: number;
  role: AgoraParticipantRole;
}

export class AgoraTokenService {
  constructor(private readonly deps: AgoraTokenServiceDeps) {}

  /**
   * Deterministically maps (meetingId, userId) → a stable 31-bit integer.
   * Same user always gets the same UID within a meeting, so tokens can be
   * reissued on reconnect without a DB lookup.
   * SHA-256 → first 4 bytes → drop sign bit → avoid 0 (Agora treats 0 as "any user").
   */
  static deriveUid(meetingId: string, userId: string): number {
    const raw = createHash('sha256').update(`${meetingId}:${userId}`).digest();
    return (raw.readUInt32BE(0) >>> 1) || 1;
  }

  /**
   * Generates an RTC token valid for tokenTtlSeconds.
   * Interviewers and candidates → PUBLISHER.
   * Supervisors → SUBSCRIBER (stealth: receives streams, cannot publish).
   */
  generateToken(params: GenerateTokenParams): string {
    const role = params.role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const expireAt = Math.floor(Date.now() / 1000) + this.deps.tokenTtlSeconds;

    return RtcTokenBuilder.buildTokenWithUid(
      this.deps.appId,
      this.deps.appCertificate,
      params.channelName,
      params.uid,
      role,
      expireAt,
    );
  }
}
