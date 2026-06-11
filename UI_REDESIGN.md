# RecruitMonitor UI/UX Redesign — Audit & Blueprint

> **Status: Phase 1 (Design Tokens) and Phase 2 (Component Primitives) implemented. Phases 3–5 pending.**
>
> The color palette, typography, spacing system, and component utility classes have been applied. JSX for individual pages and components has not been updated yet.

---

## Step 1 — Current UI Inventory

### Pages

| Page | File | Layout structure |
|------|------|-----------------|
| Login | `LoginPage.jsx` | Full-height flex centered, max-w-md card, blurred-orb background |
| Register | `RegisterPage.jsx` | Same as Login, max-w-lg, role selector cards in 3-col grid |
| Candidate pre-join | `CandidateWaitingRoom.jsx` | Full-height flex centered, max-w-md card, camera preview + toggles |
| Candidate join | `CandidateJoinPage.jsx` | Code-entry screen |
| Interviewer dashboard | `InterviewerDashboard.jsx` | Sticky header + `max-w-5xl` main, vertical list of open rooms |
| Supervisor dashboard | `SupervisorDashboard.jsx` | Sticky header + `max-w-6xl` main, 1/2/3-col grid of meeting cards |
| Interview room | `InterviewRoom.jsx` | Full-screen: top header, body split `flex-[3]` (video+participants) / `flex-[2]` (sidebar), bottom controls bar |

### Components

| Component | File | Pattern |
|-----------|------|---------|
| VideoGrid | `VideoGrid.jsx` | PiP layout (interviewer/candidate), side-by-side tiles (supervisor) |
| TranscriptBox | `TranscriptBox.jsx` | Header + scroll area + inline note input |
| NotesPanel | `NotesPanel.jsx` | Header + scroll list + bottom input bar |
| HistoryPanel | `HistoryPanel.jsx` | Header + accordion list |
| VideoResumePanel | `VideoResumePanel.jsx` | Vertical sections: shared player / upload / record |
| RoomControls | `RoomControls.jsx` | Bottom bar: left (mic+cam), right (end call) |
| ParticipantPanel | `ParticipantPanel.jsx` | Small card, 2-row participant list |
| ActiveRoomCard | `ActiveRoomCard.jsx` | glass-card-hover with timer, metadata, and primary CTA |
| CandidateHistoryModal | `CandidateHistoryModal.jsx` | Slide-in modal overlay |

### Current design tokens (post Phase 1 implementation)

**Primary palette:** Teal (`primary-500: #14b8a6`). Changed from indigo (#6366f1) during Phase 1. All `primary-*` class references in JSX pick up teal automatically without renaming. Used for: button backgrounds, active tab indicators, avatar backgrounds, transcript speaker role label, free-note left border, room code text, dot-pulse.

**Surface palette:** Zinc (`surface-950: #09090b` through `surface-50: #fafafa`). Switched from slate — warmer, less blue-cast. All `surface-*` class references continue to work.

**Semantic colors:**
- `success-400: #34d399` (emerald) — connected/active states
- `danger-500: #f43f5e` (rose) — end call, errors
- `warning-400: #fbbf24` (amber) — interrupted/waiting states only; not used as accent

**Typography:** Geist (loaded via `@fontsource/geist` npm package — no external CDN request) for sans; JetBrains Mono for mono elements. Tabular numbers (`font-feature-settings: "tnum" 1, "zero" 1`) applied globally to `.font-mono`.

**Component classes (index.css):** `glass-card`, `glass-card-hover`, `glass-input`, `btn-primary`, `btn-secondary`, `btn-danger`, `btn-icon`, `status-badge`, `toast-*`, `video-tile`, `video-tile-label`, `room-code`, `dot-pulse`.

---

## Step 2 — "AI Slop" Pattern Audit

### 1. Purple gradient on every logo icon — all auth pages and headers
**Files/lines:** `LoginPage.jsx:69`, `RegisterPage.jsx:193`, `CandidateWaitingRoom.jsx:119`, `InterviewerDashboard.jsx:123`, `SupervisorDashboard.jsx:178`, `InterviewRoom.jsx:322`, `VideoGrid.jsx:37`, `VideoGrid.jsx:79`

`bg-gradient-to-br from-primary-500 to-primary-700` appears verbatim 6 times on 6 different pages. Now that primary is teal the gradient renders teal rather than indigo, but the pattern — gradient logo on every surface — is still present in JSX and is a Phase 3–5 concern to remove.

### 2. Decorative blurred orbs — auth pages and waiting room
**Files/lines:** `LoginPage.jsx:61-64`, `RegisterPage.jsx:184-188` (three orbs), `CandidateWaitingRoom.jsx:112-115`

```jsx
// Copy-pasted identically across 3 files:
<div className="fixed inset-0 overflow-hidden pointer-events-none">
  <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-600/10 rounded-full blur-3xl" />
  <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary-400/10 rounded-full blur-3xl" />
</div>
```

10% opacity teal blurs over near-black are invisible. They add DOM nodes and GPU compositing layers. Still present in JSX — Phase 3 removes them.

### 3. Glass morphism applied indiscriminately
**Files/lines:** `index.css:66-68` (definition)

**Phase 1 status: partially fixed.** `.glass-card` now uses solid `bg-surface-800/60` with no `backdrop-blur`. GPU overhead gone. JSX still applies `glass-card` class everywhere but it now renders a sensible solid card.

### 4. `rounded-xl` / `rounded-2xl` on everything
**Phase 1 status: fixed at the component class level.** All `index.css` component classes now use `rounded-md` / `rounded-lg`. Inline `rounded-xl` in JSX is a Phase 3–5 cleanup concern.

### 5. Centered hero layout where it does not belong
**Files/lines:** `LoginPage.jsx:59`, `RegisterPage.jsx:182`, `CandidateWaitingRoom.jsx:111`

Wastes vertical space for a professional daily-use tool. Phase 3 addresses this.

### 6. Primary color overload — multiple semantic purposes
Was: `primary-400` (#818cf8, indigo) used for 12+ distinct roles simultaneously. Now: `primary-400` (#2dd4bf, teal) still broadly used, but the palette shift makes the UI read as deliberate rather than accidental. Full semantic separation is a Phase 3–5 concern.

### 7. Gradient on primary buttons
**Phase 1 status: fixed.** `.btn-primary` is now flat `bg-primary-600 hover:bg-primary-500` — no gradient, no glow shadow. `.btn-danger` is flat `bg-danger-500 hover:bg-danger-600`.

### 8. `active:scale-[0.98]` on all buttons
**Phase 1 status: fixed.** Scale transform removed from all button classes in `index.css`.

### 9. Inconsistent spacing — mixed p-4 / p-6 / p-7 / p-8 / p-16
Still present in JSX inline classes — Phase 3–5 concern.

### 10. Emoji as functional UI elements
**Files/lines:** `InterviewerDashboard.jsx:166`, `SupervisorDashboard.jsx:229`

`✕` Unicode character as close button with no `aria-label`. Phase 4 replaces with SVG icon + `aria-label="Dismiss"`.

### 11. No button hierarchy
Component classes now provide clear 4-level hierarchy (primary → secondary → ghost → destructive). JSX usage consistency is a Phase 3–5 concern.

### 12. Missing states with no personality
**Files/lines:** `HistoryPanel.jsx:93-99`, `VideoResumePanel.jsx:202-207`, `InterviewRoom.jsx:454-477`

Loading, empty, and terminated states need proper icon + heading + sub structure. Phase 5 concern.

### 13. `backdrop-blur-lg` on headers
**Files/lines:** `InterviewerDashboard.jsx:120`, `SupervisorDashboard.jsx:175`, `InterviewRoom.jsx:319`

Still present in JSX inline classes. Phase 4–5 removes these. Note: `.video-tile-label` in `index.css` intentionally **keeps** `backdrop-blur-sm` — it sits over live video where the blur is real and aids label readability.

---

## Step 3 — Proposed Design System

### Brand positioning

RecruitMonitor is a B2B productivity tool used under time pressure. The aesthetic should feel like **Linear or a Vercel dashboard**: dark, precise, information-dense, confident.

The reference mood: "we stripped everything away until only the function remained, and what's left looks good because it's honest."

### Color system (implemented)

The implemented system uses **teal** as the primary accent, not the originally proposed amber. Teal was chosen because all existing `primary-*` JSX class names continue to work without renaming (~80+ occurrences), reducing the diff scope dramatically.

**Background scale (zinc — warmer than slate):**
- `surface-950: #09090b` — page background
- `surface-900: #18181b` — card surfaces, input backgrounds
- `surface-800: #27272a` — nested hover targets
- `surface-700: #3f3f46` — borders, dividers

**Text:**
- `surface-50 / 100 / 200` — primary content hierarchy
- `surface-400 / 500` — labels, metadata, placeholders

**Accent (primary actions):** Teal — `primary-600: #0d9488` (buttons), `primary-500: #14b8a6` (interactive states), `primary-400: #2dd4bf` (icons, indicators).

**Semantic:**
- `success`: emerald `#34d399` — active/connected
- `danger`: rose `#f43f5e` — end call, errors
- `warning`: amber `#fbbf24` — interrupted, waiting (distinct from teal accent)

No color is used gradient-to-gradient on interactive elements. Solid fills only. Gradients reserved for video overlays (`gradient-to-t from-black/60` on video name labels — this is correct and stays).

### Original amber proposal (not implemented)

The audit document originally proposed amber (`#f59e0b`) as the accent color. This was not adopted because:
1. It would require renaming all `primary-*` class references in JSX (~80+ occurrences)
2. Teal achieves the same "not-the-typical-SaaS-purple" distinctiveness with zero JSX changes
3. Amber tokens remain as `warning-400/500/600` for interrupted/waiting states where amber's warmth is semantically appropriate

### Typography (implemented)

**Font:** Geist loaded via `@fontsource/geist` npm package (weights 300–800). No external CDN request — bundled. JetBrains Mono for mono elements (IDs, timers, room codes).

**Tabular numbers:** `.font-mono` globally sets `font-feature-settings: "tnum" 1, "zero" 1`. Elapsed timers and segment counts use monospaced digits that don't shift layout.

**Type scale:** Tailwind defaults used as-is. Inline size scatter in JSX is a Phase 3–5 cleanup concern.

### Spacing and layout

4px grid. Component internal padding: 12–16px. Page padding: `px-6 py-6` desktop. Max content widths unchanged pending Phase 4.

### Component primitives (implemented in index.css)

**Buttons — 4-level hierarchy:**
- **Primary:** `bg-primary-600 text-white rounded-md font-medium` — flat teal, no gradient, no glow, no scale
- **Secondary:** `bg-surface-800 border border-surface-600/50 text-surface-200 rounded-md` — flat
- **Danger:** `bg-danger-500 text-white rounded-md` — flat rose, no gradient
- **Icon-only:** `bg-surface-800/80 rounded-md` — 44px touch target

**Inputs:** `bg-surface-900/80 border border-surface-700/60 rounded-md` — focus: `border-primary-500`. No `rounded-xl`. No blurred focus ring.

**Cards:** `bg-surface-800/60 border border-surface-700/50 rounded-lg` — no backdrop-blur, no gradient, no glow. Hover variant brightens border only.

**Status badges:** `rounded text-xs font-medium` — `rounded` (2px) not `rounded-full`.

### Motion (implemented)

**Kept:**
- `animate-fade-in` (150ms ease-out)
- `animate-slide-up` (200ms ease-out)
- `animate-slide-in-right` (200ms ease-out) — new, used by toasts
- `dot-pulse` — appropriate waiting indicator
- `animate-pulse` on status dots

**Removed from index.css:**
- `active:scale-[0.98]` on all buttons
- `hover:shadow-primary-500/40` on buttons
- `hover:shadow-xl hover:shadow-primary-500/5` on cards

---

## Step 4 — Mobile Responsiveness Plan

The app has no mobile layout in JSX. Every surface uses fixed-width flex ratios or large max-widths. This is a Phase 4–5 concern.

### InterviewRoom (`InterviewRoom.jsx`)

**Current:** `flex-[3] / flex-[2]` split (60/40), no breakpoints.

**Proposed mobile layout (below `md: 768px`):**

```
┌─────────────────────────────────┐
│  Header bar (logo + meeting ID) │ — 48px, no user name
├─────────────────────────────────┤
│                                 │
│   Video area (aspect-video)     │ — 16:9, full width
│   (PiP overlay stays draggable) │
│                                 │
├─────────────────────────────────┤
│   Panel content area            │ — fills remaining height
│   (transcript / notes / etc.)   │
│                                 │
├─────────────────────────────────┤
│ [mic] [cam]  [T] [N] [V] [H] [end] │ — 56px fixed bottom bar
└─────────────────────────────────┘
```

### InterviewerDashboard (`InterviewerDashboard.jsx`)

Below `md`: header shows only logo + connection dot + logout. Room list items stack vertically — candidate name → wait label + History pill → full-width Join button.

### SupervisorDashboard (`SupervisorDashboard.jsx`)

Already `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` — single column on mobile is correct. Minor: simplify header on mobile, hide "Live monitoring" indicator row.

### CandidateWaitingRoom (`CandidateWaitingRoom.jsx`)

Remove `py-12` on mobile. Increase toggle button height to 40px (`py-2.5`).

### Auth pages (Login, Register)

Reduce `py-12` to `py-4` on mobile. Register role selector: `grid-cols-1` on mobile, `grid-cols-3` from `sm:`.

### RoomControls (`RoomControls.jsx`)

End Call button: add `min-w-[88px]` so label doesn't wrap on narrow screens.

---

## Step 5 — Prioritized Implementation Roadmap

### Phase 1 — Design tokens ✅ COMPLETE

**What:** Color palette (indigo → teal), surface (slate → zinc), typography (Inter → Geist via `@fontsource/geist` npm), button/card/input class rewrites, animation keyframes.

**Files touched:**
1. `client/tailwind.config.js` — teal `primary-*`, zinc `surface-*`, emerald/rose/amber semantic colors, Geist font, `animate-slide-in-right`
2. `client/src/index.css` — removed gradients/glows/scale from all buttons; removed `backdrop-blur` from `.glass-card`; `rounded-md` on inputs; `font-feature-settings: "tnum"` on `.font-mono`; solid toasts; new `animate-slide-in-right` toast

**Changes from original proposal:** Primary accent is teal (#14b8a6) not amber (#f59e0b). Avoids ~80 JSX class renames.

**Risk: Low.** Token changes don't affect behavior.

---

### Phase 2 — Component primitives ✅ COMPLETE

**What:** Small, stateless building blocks pick up the new visual language through the `index.css` changes landed in Phase 1. No JSX edits required — styles apply via existing class names.

All button, card, input, badge, and toast component classes updated and verified.

**Risk: Low.** Presentational only.

---

### Phase 3 — Auth flow (Login, Register)

**What:** Remove blurred-orb decorations, replace gradient logo with flat teal mark, left-align form within card, improve role selector, fix mobile spacing.

**Files to touch (in order):**
1. `client/src/pages/LoginPage.jsx`
2. `client/src/pages/RegisterPage.jsx`
3. `client/src/pages/CandidateJoinPage.jsx`

**Risk: Very low.** Isolated pages, no shared state or socket effects.

---

### Phase 4 — Dashboards and pre-join screens

**What:** Flatten gradient logos to flat teal marks. Simplify mobile headers. Replace `✕` emoji close button with SVG + `aria-label`. Add proper empty states (icon + heading + description). Mobile-responsive room list stacking.

**Files to touch (in order):**
1. `client/src/pages/CandidateWaitingRoom.jsx`
2. `client/src/pages/InterviewerDashboard.jsx`
3. `client/src/components/CandidateHistoryModal.jsx`
4. `client/src/pages/SupervisorDashboard.jsx`
5. `client/src/pages/CandidateJoinPage.jsx`

**Risk: Medium.** These pages have socket connections and real-time state. Visual-only changes are safe; avoid touching event registration or store updates. Test all socket-connected states after each file.

---

### Phase 5 — InterviewRoom and in-call panels (most complex, do last)

**What:** Remove gradient avatar circles. Tighten panel headers (no colored icon). Fix note item styling. Add proper loading/empty states with icon + heading + sub. Add mobile layout. Fix terminated countdown dot logic.

**Files to touch (in order):**
1. `client/src/components/VideoGrid.jsx`
2. `client/src/components/TranscriptBox.jsx`
3. `client/src/components/NotesPanel.jsx`
4. `client/src/components/HistoryPanel.jsx`
5. `client/src/components/VideoResumePanel.jsx`
6. `client/src/pages/InterviewRoom.jsx` — layout restructure + mobile breakpoint (last)

**Specific fixes in InterviewRoom.jsx:**
- Terminated countdown: dots should **drain** from 5 to 0, not fill left-to-right (logic is currently inverted)
- Remove `backdrop-blur-lg` from header: `bg-surface-950/80 backdrop-blur-lg` → `bg-surface-950`
- Add `md:` breakpoints for mobile stacked layout with combined controls+tabs bar

**Risk: High on InterviewRoom.jsx.** Any change to JSX tree structure risks touching `useEffect` dependency arrays, `socket.on` registration, or `startTransition` boundaries. Make structural layout changes in a single diff, run the full socket/Agora/Deepgram flow manually before committing.

---

## Summary

| Phase | Files | Risk | Scope | Status |
|-------|-------|------|-------|--------|
| 1 — Tokens | `tailwind.config.js`, `index.css` | Low | Color, type, spacing, animations | ✅ Done |
| 2 — Primitives | `index.css` component classes | Low | Buttons, cards, inputs, toasts | ✅ Done |
| 3 — Auth | 2-3 pages | Very low | Login, Register, Candidate join | Pending |
| 4 — Dashboards | 5 pages/components | Medium | Interviewer, Supervisor, Waiting room | Pending |
| 5 — InterviewRoom | 6 components + 1 page | High | In-call UI, mobile layout | Pending |

Phase 3 can ship standalone. Phase 4 requires socket testing. Phase 5 requires a full call test (Agora + Deepgram + Socket.IO) before shipping.
