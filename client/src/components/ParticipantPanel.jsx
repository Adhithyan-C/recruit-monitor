import { useState } from 'react';

function initial(name) {
  return name ? name.charAt(0).toUpperCase() : '?';
}

function Avatar({ name }) {
  return (
    <div className="w-7 h-7 rounded-full bg-surface-800 border border-surface-700 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-semibold text-surface-300">{initial(name)}</span>
    </div>
  );
}

function Row({ name, label, online }) {
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 rounded-md">
      <Avatar name={name} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${name ? 'text-surface-200' : 'text-surface-500 italic'}`}>
          {name || `Waiting for ${label}…`}
        </p>
        <p className="text-xs text-surface-500 capitalize">{label}</p>
      </div>
      {/* Presence dot — no glow, just a solid 6px circle */}
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${online ? 'bg-success-400' : 'bg-surface-600 animate-pulse'}`} />
    </div>
  );
}

export default function ParticipantPanel({ interviewerName, candidateName }) {
  // Collapsed by default on mobile; always expanded on desktop.
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  );

  return (
    <div className="glass-card overflow-hidden">
      {/* Header — tappable on mobile to collapse/expand */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left md:cursor-default"
      >
        <h3 className="text-xs font-medium text-surface-400 uppercase tracking-widest">
          Participants
        </h3>
        <svg
          className={`w-3.5 h-3.5 text-surface-500 md:hidden transition-transform duration-150 ${collapsed ? '' : 'rotate-180'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body — hidden on mobile when collapsed, always visible on md+ */}
      <div className={`px-2 pb-2 space-y-0.5 ${collapsed ? 'hidden md:block' : ''}`}>
        <Row name={interviewerName} label="interviewer" online={!!interviewerName} />
        <Row name={candidateName}   label="candidate"   online={!!candidateName} />
      </div>
    </div>
  );
}
