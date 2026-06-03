import { useEffect, useRef, useState, useCallback } from 'react';

const PIP_W        = 160;
const PIP_H        = 120;
const PIP_W_MOBILE = 96;
const PIP_H_MOBILE = 72;
const PIP_MARGIN   = 12;

function useMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

// Avatar shown when there is no video track — flat zinc circle, no gradient.
function InitialAvatar({ name, size = 'lg' }) {
  const letter = name ? name.charAt(0).toUpperCase() : '?';
  const cls = size === 'lg'
    ? 'w-20 h-20 text-2xl'
    : size === 'xl'
    ? 'w-24 h-24 text-3xl'
    : 'w-10 h-10 text-base';
  return (
    <div className={`rounded-full bg-surface-800 border-2 border-surface-700 flex items-center justify-center ${cls}`}>
      <span className="font-semibold text-surface-300">{letter}</span>
    </div>
  );
}

// Side-by-side tile used in the supervisor view
function VideoTile({ user, label, size = 'large' }) {
  const tileRef        = useRef(null);
  const playedTrackRef = useRef(null);
  const showAvatar     = !user?.videoTrack;

  useEffect(() => {
    if (showAvatar) return;
    const track     = user?.videoTrack;
    const container = tileRef.current;
    if (track && container && playedTrackRef.current !== track) {
      playedTrackRef.current?.stop?.();
      track.play(container);
      playedTrackRef.current = track;
    }
    return () => {
      if (track && playedTrackRef.current === track) {
        try { track.stop(); } catch (e) { console.warn(e); }
        playedTrackRef.current = null;
      }
    };
  }, [user?.videoTrack, showAvatar]);

  const sizeClasses = size === 'large' ? 'w-full h-full min-h-[300px]' : 'w-48 h-36';

  return (
    <div className={`video-tile ${sizeClasses}`}>
      {showAvatar ? (
        <div className="w-full h-full flex items-center justify-center bg-surface-800">
          <InitialAvatar name={label} size="lg" />
        </div>
      ) : (
        <div ref={tileRef} className="w-full h-full" />
      )}
      <div className="video-tile-label">
        <span>{label || 'Unknown'}</span>
      </div>
    </div>
  );
}

// Full-screen remote tile for the PiP layout (interviewer/candidate view)
function RemoteTile({ user, label }) {
  const tileRef        = useRef(null);
  const playedTrackRef = useRef(null);
  const showAvatar     = !user?.videoTrack;

  useEffect(() => {
    if (showAvatar) return;
    const track     = user?.videoTrack;
    const container = tileRef.current;
    if (track && container && playedTrackRef.current !== track) {
      playedTrackRef.current?.stop?.();
      track.play(container);
      playedTrackRef.current = track;
    }
    return () => {
      if (track && playedTrackRef.current === track) {
        try { track.stop(); } catch (e) { console.warn(e); }
        playedTrackRef.current = null;
      }
    };
  }, [user?.videoTrack, showAvatar]);

  if (showAvatar) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface-900">
        <InitialAvatar name={label} size="xl" />
      </div>
    );
  }

  return <div ref={tileRef} className="absolute inset-0" />;
}

// Draggable local PiP overlay.
// On mobile: shrinks to 96×72, locks to bottom-right, drag disabled.
function PipTile({ videoRef, localVideoTrack, label, isMuted, isCameraOff, containerRef }) {
  const isMobile       = useMobile();
  const [pos, setPos]  = useState(null); // null = CSS default (bottom-right)
  const dragRef        = useRef(null);
  const playedTrackRef = useRef(null);

  useEffect(() => {
    if (isCameraOff) return;
    const track     = localVideoTrack;
    const container = videoRef?.current;
    if (track && container && playedTrackRef.current !== track) {
      playedTrackRef.current?.stop?.();
      track.play(container);
      playedTrackRef.current = track;
    }
    return () => {
      if (track && playedTrackRef.current === track) {
        try { track.stop(); } catch (e) { console.warn(e); }
        playedTrackRef.current = null;
      }
    };
  }, [localVideoTrack, videoRef, isCameraOff]);

  const onMouseDown = useCallback((e) => {
    if (isMobile) return; // drag disabled on touch screens
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const cRect   = container.getBoundingClientRect();
    const pipRect = e.currentTarget.getBoundingClientRect();

    dragRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startLeft:   pipRect.left - cRect.left,
      startTop:    pipRect.top  - cRect.top,
      cWidth:      cRect.width,
      cHeight:     cRect.height,
    };

    const onMouseMove = (ev) => {
      if (!dragRef.current) return;
      const { startMouseX, startMouseY, startLeft, startTop, cWidth, cHeight } = dragRef.current;
      const pipW  = isMobile ? PIP_W_MOBILE : PIP_W;
      const pipH  = isMobile ? PIP_H_MOBILE : PIP_H;
      const left  = Math.max(0, Math.min(startLeft + ev.clientX - startMouseX, cWidth  - pipW));
      const top   = Math.max(0, Math.min(startTop  + ev.clientY - startMouseY, cHeight - pipH));
      setPos({ left, top });
    };

    const onMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
  }, [isMobile, containerRef]);

  const pipW = isMobile ? PIP_W_MOBILE : PIP_W;
  const pipH = isMobile ? PIP_H_MOBILE : PIP_H;
  // On mobile ignore any dragged position — always lock to bottom-right.
  const posStyle = (pos && !isMobile)
    ? { left: pos.left, top: pos.top }
    : { right: PIP_MARGIN, bottom: PIP_MARGIN };

  return (
    <div
      onMouseDown={onMouseDown}
      style={{ ...posStyle, width: pipW, height: pipH, position: 'absolute' }}
      className={`z-10 rounded-md overflow-hidden border border-surface-700/50 shadow-lg select-none ${
        isMobile ? '' : 'cursor-grab active:cursor-grabbing'
      }`}
    >
      {isCameraOff ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-surface-800 gap-1.5">
          <div className="w-8 h-8 rounded-full bg-surface-700 border border-surface-600 flex items-center justify-center">
            <span className="text-xs font-semibold text-surface-300">
              {label ? label.charAt(0).toUpperCase() : '?'}
            </span>
          </div>
          <svg className="w-4 h-4 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
      ) : (
        <div ref={videoRef} className="w-full h-full" />
      )}

      {/* Mute + name strip */}
      <div className="absolute bottom-0 inset-x-0 px-1.5 py-1 flex items-center gap-1 bg-black/50 pointer-events-none">
        <svg
          className={`w-2.5 h-2.5 flex-shrink-0 ${isMuted ? 'text-danger-400' : 'text-success-400'}`}
          fill="currentColor" viewBox="0 0 24 24"
        >
          {isMuted ? (
            <path d="M1.5 4.5l21 15m-2.25-4.5a9.75 9.75 0 01-2.599 2.083M12 18.75a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M9 4.51A3.75 3.75 0 0112 3a3.75 3.75 0 013.75 3.75v3.75a3.75 3.75 0 01-.356 1.593" />
          ) : (
            <path d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          )}
        </svg>
        <span className="text-white text-[10px] truncate">{label}</span>
      </div>
    </div>
  );
}

export default function VideoGrid({ role, localVideoRef, localVideoTrack, remoteUsers, isMuted, isCameraOff, localName, uidToName }) {
  const containerRef = useRef(null);
  const resolveName  = (uid) => (uidToName && uid != null && uidToName[uid]) ? uidToName[uid] : String(uid || 'Participant');

  if (role === 'supervisor') {
    return (
      <div className="relative w-full h-full flex gap-3">
        {remoteUsers.length > 0 ? (
          <>
            <div className="flex-1">
              <VideoTile user={remoteUsers[0]} label={resolveName(remoteUsers[0]?.uid)} size="large" />
            </div>
            {remoteUsers.length > 1 && (
              <div className="w-64">
                <VideoTile user={remoteUsers[1]} label={resolveName(remoteUsers[1]?.uid)} size="large" />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">
            Waiting for participants…
          </div>
        )}
      </div>
    );
  }

  // Interviewer / Candidate: PiP layout
  const remoteUser = remoteUsers[0];

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-surface-900 rounded-lg">
      {/* Remote tile — fills entire container */}
      {remoteUser ? (
        <>
          <RemoteTile user={remoteUser} label={resolveName(remoteUser.uid)} />
          {/* Name gradient overlay */}
          <div className="absolute bottom-0 inset-x-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none z-[5]">
            <div className="absolute bottom-3 left-4">
              <span className="text-white text-sm font-medium drop-shadow">
                {resolveName(remoteUser.uid)}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="dot-pulse mb-4 justify-center">
              <span /><span /><span />
            </div>
            <p className="text-surface-400 text-sm">Waiting for the other participant…</p>
          </div>
        </div>
      )}

      {/* Local PiP — draggable on desktop, locked bottom-right on mobile */}
      <PipTile
        videoRef={localVideoRef}
        localVideoTrack={localVideoTrack}
        label={localName || 'You'}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        containerRef={containerRef}
      />
    </div>
  );
}
