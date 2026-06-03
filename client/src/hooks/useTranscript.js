import { useEffect, useRef } from 'react';
import { useTranscriptStore } from '../store/useTranscriptStore.js';
import { mediaLog } from '../utils/mediaLogger.js';

// roomId param removed — server resolves meeting from socket.data.meetingId.
export default function useTranscript({ localAudioTrack, socket, enabled, paused = false }) {
  const cleanupRef    = useRef(null);
  const pipelineIdRef = useRef(null);
  const pausedRef     = useRef(paused);
  const audioContextRef = useRef(null);
  const socketRef     = useRef(socket);
  const emittedChunksRef = useRef(0);

  useEffect(() => { socketRef.current = socket; }, [socket]);

  useEffect(() => {
    const wasPaused = pausedRef.current;
    pausedRef.current = paused;
    if (wasPaused && !paused) {
      const ctx = audioContextRef.current;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch((err) =>
          mediaLog('warn', 'transcript audioContext resume on unpause failed', { reason: err.message }),
        );
      }
    }
  }, [paused]);

  // ── Heartbeat ─────────────────────────────────────────────────────────
  // Candidate must emit heartbeat every 10s for presence keepalive.
  // Independent of the audio pipeline — runs as long as the socket exists.

  useEffect(() => {
    if (!socket) return;
    const timer = setInterval(() => {
      if (socket.connected) socket.emit('heartbeat');
    }, 10_000);
    return () => clearInterval(timer);
  }, [socket]);

  // ── Audio pipeline ────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !localAudioTrack || !socketRef.current) return;
    if (!window.AudioWorklet) {
      mediaLog('warn', 'transcript audio worklet unsupported');
      return;
    }
    if (cleanupRef.current && pipelineIdRef.current === localAudioTrack) {
      mediaLog('warn', 'transcript duplicate pipeline prevented');
      return;
    }

    let destroyed = false;
    let audioContext = null;
    let source = null;
    let workletNode = null;
    let mediaStreamTrack = null;
    let healthTimer = null;
    emittedChunksRef.current = 0;
    pipelineIdRef.current = localAudioTrack;

    const handleSegment = (segment) => {
      useTranscriptStore.getState().addSegment(segment);
    };

    const handleError = () => {
      mediaLog('warn', 'transcript server error received');
      useTranscriptStore.getState().setTranscriptionFailed(true);
    };

    function handleTrackEnded() {
      mediaLog('warn', 'transcript media track ended');
      useTranscriptStore.getState().setTranscriptionFailed(true);
    }

    function handleTrackMuted() {
      mediaLog('info', 'transcript media track muted');
    }

    function handleTrackUnmuted() {
      mediaLog('info', 'transcript media track unmuted');
      audioContext?.resume?.().catch((err) =>
        mediaLog('warn', 'transcript resume after unmute failed', { reason: err.message }),
      );
    }

    function handleSocketConnect() {
      mediaLog('info', 'transcript socket reconnected');
    }

    function handleSocketDisconnect(reason) {
      mediaLog('warn', 'transcript socket disconnected', { reason });
    }

    function cleanup() {
      const sock = socketRef.current;
      sock?.off('transcript_segment', handleSegment);
      sock?.off('transcript_error', handleError);
      sock?.off('connect', handleSocketConnect);
      sock?.off('disconnect', handleSocketDisconnect);
      clearInterval(healthTimer);
      mediaStreamTrack?.removeEventListener('ended', handleTrackEnded);
      mediaStreamTrack?.removeEventListener('mute', handleTrackMuted);
      mediaStreamTrack?.removeEventListener('unmute', handleTrackUnmuted);
      audioContextRef.current = null;
      try {
        workletNode?.disconnect();
        source?.disconnect();
        if (audioContext && audioContext.state !== 'closed') audioContext.close();
      } catch (err) {
        mediaLog('warn', 'transcript cleanup failed', { reason: err.message });
      }
      mediaLog('info', 'transcript pipeline stopped');
    }

    async function startPipeline() {
      try {
        mediaStreamTrack = localAudioTrack.getMediaStreamTrack();
        if (!mediaStreamTrack || mediaStreamTrack.readyState === 'ended') {
          mediaLog('warn', 'transcript media track unavailable');
          return;
        }

        mediaStreamTrack.addEventListener('ended',   handleTrackEnded);
        mediaStreamTrack.addEventListener('mute',    handleTrackMuted);
        mediaStreamTrack.addEventListener('unmute',  handleTrackUnmuted);

        const stream = new MediaStream([mediaStreamTrack]);
        audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
        await audioContext.audioWorklet.addModule('/audio-processor.js');
        source = audioContext.createMediaStreamSource(stream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        source.connect(workletNode);

        workletNode.port.onmessage = async (event) => {
          if (destroyed || pausedRef.current) return;
          if (audioContext?.state === 'suspended') {
            try { await audioContext.resume(); } catch { /* non-critical */ }
          }
          const buffer = event.data;
          const sock = socketRef.current;
          if (buffer && buffer.byteLength > 0 && sock?.connected) {
            sock.emit('audio_chunk', buffer);
            emittedChunksRef.current++;
          }
        };

        const sock = socketRef.current;
        sock.on('transcript_segment', handleSegment);
        sock.on('transcript_error',   handleError);
        sock.on('connect',            handleSocketConnect);
        sock.on('disconnect',         handleSocketDisconnect);

        healthTimer = setInterval(() => {
          mediaLog('info', 'transcript pipeline health', {
            chunks:           emittedChunksRef.current,
            paused:           pausedRef.current,
            socketConnected:  socketRef.current?.connected,
            trackState:       mediaStreamTrack?.readyState,
            trackEnabled:     mediaStreamTrack?.enabled,
            audioContextState: audioContextRef.current?.state,
          });
        }, 15_000);

        cleanupRef.current = cleanup;
        mediaLog('info', 'transcript pipeline started');
      } catch (err) {
        mediaLog('error', 'transcript pipeline start failed', { reason: err.message });
      }
    }

    startPipeline();

    return () => {
      destroyed = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
      pipelineIdRef.current = null;
    };
  }, [localAudioTrack, enabled]);
}
