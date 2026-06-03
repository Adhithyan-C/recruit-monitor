declare module 'agora-token' {
  export const RtcRole: { readonly PUBLISHER: 1; readonly SUBSCRIBER: 2 };

  export class RtcTokenBuilder {
    static buildTokenWithUid(
      appId: string,
      appCertificate: string,
      channelName: string,
      uid: number,
      role: 1 | 2,
      tokenExpire: number,
      privilegeExpire?: number,
    ): string;
  }

  // CJS default export shape — used via createRequire in ESM context.
  const _default: {
    RtcRole: typeof RtcRole;
    RtcTokenBuilder: typeof RtcTokenBuilder;
  };
  export default _default;
}
