# RecruitMonitor UI/UX Redesign — Audit & Blueprint

> **Status: Pending approval. No code has been changed.**

---

## Step 1 — Current UI Inventory

### Pages

| Page | File | Layout structure |
|------|------|-----------------|
| Login | `LoginPage.jsx` | Full-height flex centered, max-w-md card, blurred-orb background |
| Register | `RegisterPage.jsx` | Same as Login, max-w-lg, role selector cards in 3-col grid |
| Candidate pre-join | `CandidateWaitingRoom.jsx` | Full-height flex centered, max-w-md card, camera preview + toggles |
| Candidate join | `CandidateJoinPage.jsx` | (Not audited — file path suggests a code-entry screen) |
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

### Current design tokens

**Primary palette:** Indigo/violet (`primary-500: #6366f1`). Used for: logo icons, button backgrounds, focus rings, active tab indicators, avatar backgrounds, transcript speaker role label, free-note left border, "Monitoring Mode" badge, room code text, history spinner, section header icons. It appears on every single screen in nearly every interaction state.

**Surface palette:** Slate (`surface-950: #020617` through `surface-50: #f8fafc`). Body background is `surface-950`. Cards are `surface-800/60`. Inputs are `surface-900/80`. Text is `surface-50 / 200 / 300 / 400 / 500 / 600` — a 6-stop hierarchy that in practice collapses to 3 (bright, medium, dim).

**Semantic colors:** `success-400: #4ade80`, `danger-400: #f87171`, `warning-400: #fbbf24`. All correct colors for their roles. Used consistently.

**Typography:** Inter (all weights) + JetBrains Mono. No `font-feature-settings`. No tabular numbers. The type scale is not defined as a token — sizes are scattered inline (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`) without a documented scale.

**Component classes (index.css):** `glass-card`, `glass-card-hover`, `glass-input`, `btn-primary`, `btn-secondary`, `btn-danger`, `btn-icon`, `status-badge`, `toast-*`, `video-tile`, `video-tile-label`, `room-code`, `dot-pulse`.

---

## Step 2 — "AI Slop" Pattern Audit

### 1. Purple gradient on every logo icon — all auth pages and headers
**Files/lines:** `LoginPage.jsx:69`, `RegisterPage.jsx:193`, `CandidateWaitingRoom.jsx:119`, `InterviewerDashboard.jsx:123`, `SupervisorDashboard.jsx:178`, `InterviewRoom.jsx:322`, `VideoGrid.jsx:37`, `VideoGrid.jsx:79`

`bg-gradient-to-br from-primary-500 to-primary-700` appears verbatim 6 times on 6 different pages. The logo is a 10×10 (or 8×8, or 7×7) indigo square with a white icon inside it. On `VideoGrid.jsx` the avatar fallback circle also uses the same gradient. This is the single most overused pattern in the codebase and the clearest signal that the UI was scaffolded by an AI writing "make it look polished."

### 2. Decorative blurred orbs — auth pages and waiting room
**Files/lines:** `LoginPage.jsx:61-64`, `RegisterPage.jsx:184-188` (three orbs, one centered), `CandidateWaitingRoom.jsx:112-115`

```jsx
// Copy-pasted identically across 3 files:
<div className="fixed inset-0 overflow-hidden pointer-events-none">
  <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-600/10 rounded-full blur-3xl" />
  <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary-400/10 rounded-full blur-3xl" />
</div>
```

On a near-black (`#020617`) background, 10% opacity purple blurs are invisible to most users. They serve zero perceptual purpose and add DOM nodes, `backdrop-filter` calculations, and GPU compositing layers. The Register page adds a third central orb for good measure.

### 3. Glass morphism applied indiscriminately
**Files/lines:** `index.css:49-55` (definition), used in every card across every page

`glass-card` = `backdrop-blur-lg` on a surface that is already a flat, opaque near-black background. Backdrop blur is only meaningful when you can see content behind the element. Over `surface-950`, it blurs nothing and adds GPU overhead. `glass-card-hover` further adds `shadow-primary-500/5` — a purple glow on hover that is 5% opacity and therefore invisible.

### 4. `rounded-xl` / `rounded-2xl` on everything, without semantic meaning
**Files/lines:** `index.css:50, 58, 65, 72, 79, 84, 147, 163`

Every element uses either `rounded-xl` (12px) or `rounded-2xl` (16px): cards, inputs, buttons, icon buttons, video tiles, room code displays, error banners, note items, history items, role selector cards, status badges. The border radius is a single undifferentiated value. When everything is equally rounded, nothing is. The result is a UI that looks soft and toy-like rather than professional.

### 5. Centered hero layout where it does not belong
**Files/lines:** `LoginPage.jsx:59`, `RegisterPage.jsx:182`, `CandidateWaitingRoom.jsx:111`

All three screens use `flex-1 flex items-center justify-center` to center a max-width card in the viewport. This is appropriate for consumer apps. For a B2B tool used by recruiters and interviewers multiple times per day, it wastes vertical space and creates an unnecessary "welcome" ceremony. The pre-join screen is especially odd — the camera preview and controls should feel like a functional tool, not a landing page.

### 6. Primary color overload — `primary-400` used for 12+ distinct semantic purposes
**Files/lines:** Across essentially every file

`primary-400` (#818cf8, light indigo) is used for: section header icons (TranscriptBox, NotesPanel, HistoryPanel), active tab border (InterviewRoom), avatar backgrounds (VideoGrid), room code text (ActiveRoomCard), "Monitoring Mode" badge, socket spinner, transcript speaker label for candidates, left border on free notes, focus rings on all inputs, "History" pill button text, wait-time badge background. When the accent color carries 12 different meanings simultaneously, it carries none of them.

### 7. Gradient on primary buttons
**Files/lines:** `index.css:64-69` (`btn-primary`), `index.css:78-81` (`btn-danger`)

```css
.btn-primary {
  @apply bg-gradient-to-r from-primary-600 to-primary-500 ...
         shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 ...
}
```

Both `.btn-primary` and `.btn-danger` use `from-/to-` gradients. A solid flat color conveys authority more clearly than a gradient. The shadow glow (`shadow-primary-500/25`) means every button casts a purple halo on its surroundings — this is the defining characteristic of "AI-generated dark UI."

### 8. `active:scale-[0.98]` on all buttons
**Files/lines:** `index.css:67, 74`

All buttons scale down to 98% on click. Scale transforms on button press feel appropriate on consumer touch apps. On a professional desktop tool where you're clicking dozens of times per session, this micro-animation is distracting and makes the UI feel playful rather than crisp.

### 9. Inconsistent spacing — mixed p-4 / p-6 / p-7 / p-8 / p-16 without system
**Files/lines:** `LoginPage.jsx:79` (p-8), `RegisterPage.jsx:203` (p-7), `CandidateWaitingRoom.jsx:130` (p-6), `SupervisorDashboard.jsx:235` (p-16 on empty state card)

The empty state in `SupervisorDashboard.jsx:235` uses `p-16` (64px padding), creating an enormous void. `LoginPage` uses `p-8`, `RegisterPage` uses `p-7` — one is `mb-4`, another `mb-6`, another `mb-5`. These are not systematic choices; they are "this looked okay" choices.

### 10. Emoji as functional UI elements
**Files/lines:** `InterviewerDashboard.jsx:166`, `SupervisorDashboard.jsx:229`

```jsx
<button onClick={() => setError('')} className="ml-auto text-surface-500 hover:text-surface-300">✕</button>
```

The close button on error banners uses the `✕` Unicode character (U+2715), which renders inconsistently across platforms and is not accessible (no `aria-label`). This is a single character that should be an SVG icon or at minimum an `×` HTML entity.

### 11. No button hierarchy — primary and secondary compete visually
**Files/lines:** `InterviewerDashboard.jsx:143` (Logout uses `btn-secondary`), `RoomControls.jsx:41-46` (End Call uses `btn-danger`)

In the interviewer dashboard header, "Logout" renders as a visually prominent secondary button. In `RoomControls`, "End Call" is styled as `btn-danger` (gradient red, large). These are correct choices in isolation, but the broader problem is that across the InterviewRoom sidebar, every small "Add" / "Save" / "Cancel" button also uses `btn-primary` and `btn-secondary` at the same visual weight. There is no hierarchy of primary → secondary → ghost → link.

### 12. Missing states with no personality
**Files/lines:** `HistoryPanel.jsx:93-99` (spinner-only loading), `VideoResumePanel.jsx:202-207` (bare text empty state), `InterviewRoom.jsx:454-477` (terminated overlay)

- Loading state in `HistoryPanel` is a centered spinner with no text — no sense of what is being loaded or how long it might take.
- Empty state in `VideoResumePanel` for supervisor: `<p className="text-surface-500 text-sm text-center">No video has been shared yet.</p>` — completely unstyled, no icon, no affordance.
- The "Interview Ended" terminated overlay renders a progress dot-row (5 dots, `i < 5 - terminatedCountdown`) that fills left-to-right as time runs out. The logic is inverted — dots should drain, not fill — and the visual metaphor is unclear.

### 13. `backdrop-blur-lg` on headers — invisible effect with real cost
**Files/lines:** `InterviewerDashboard.jsx:120`, `SupervisorDashboard.jsx:175`, `InterviewRoom.jsx:319`

All three headers use `bg-surface-950/80 backdrop-blur-lg` — an 80% opaque near-black surface. The 20% transparency blurs essentially nothing. `backdrop-blur` triggers GPU compositing regardless of whether blur is visible. On the interview room page this contributes to compositing layers on an already GPU-heavy page (Agora video).

---

## Step 3 — Proposed Design System

### Brand positioning

RecruitMonitor is a B2B productivity tool used under time pressure. An interviewer opens it, a candidate is waiting, and there is no time to appreciate decorative blur effects. The aesthetic should feel like **Linear or a Vercel dashboard**: dark, precise, information-dense, confident. Every element should communicate that this is a serious tool built by people who understand their domain.

The reference mood: "we stripped everything away until only the function remained, and what's left looks good because it's honest."

### Color system

Abandon the indigo/violet `primary-*` palette entirely. Replace with:

**Base backgrounds (zinc family — warmer and less blue than slate):**
- `bg-base`: `#09090b` (zinc-950) — page background
- `bg-1`: `#111113` — primary card surface (replaces `surface-800/60`)
- `bg-2`: `#18181b` — nested surfaces, inputs, hover targets (replaces `surface-900/80`)
- `bg-3`: `#27272a` — active / pressed states, secondary hover

**Borders:**
- `border-subtle`: `#27272a` (zinc-800) — card edges, dividers
- `border-default`: `#3f3f46` (zinc-700) — input borders, visible separators
- `border-strong`: `#52525b` (zinc-600) — focus states, selected items

**Text:**
- `text-primary`: `#fafafa` (zinc-50) — primary content
- `text-secondary`: `#a1a1aa` (zinc-400) — labels, metadata, descriptions
- `text-tertiary`: `#71717a` (zinc-500) — placeholders, disabled labels
- `text-disabled`: `#52525b` (zinc-600) — truly disabled content

**Accent (primary actions, key interactive states):** **Amber** — `#f59e0b` (dark), `#fbbf24` (standard), `#fde68a` (light tint for backgrounds).

Rationale: Amber is warm, confident, and premium-feeling on dark backgrounds. It's the color of professional precision instruments (cameras, watches). It is not the typical SaaS purple-blue, which means it's immediately distinctive. It works against near-black better than cool colors. Secondary benefit: it distinguishes visually from all semantic colors (green/red/yellow).

- `accent`: `#f59e0b` — buttons, active indicators, links
- `accent-hover`: `#d97706` — hover state
- `accent-subtle`: `rgba(245, 158, 11, 0.12)` — badge backgrounds, selection tints
- `accent-border`: `rgba(245, 158, 11, 0.25)` — badge/pill borders

**Semantic (unchanged in hue, adjusted for consistency):**
- `success`: `#22c55e` — active/connected, recording live, transcript confirmed
- `danger`: `#ef4444` — end call, errors, muted/camera-off indicator
- `warning`: `#eab308` — interrupted connection, waiting states (yellow, not amber, to stay distinct from accent)

No color should be used gradient-to-gradient on interactive elements. Solid fills only. Gradients reserved for: video overlays (the gradient-to-t from-black/60 on video name labels — this is correct and should stay).

### Typography

**Font:** Switch from Inter to **Geist** (Vercel's open-source font, available via CDN). Geist is designed for UI at small sizes, has excellent legibility in its condensed variants, and carries a "serious technical tool" character that Inter in its default configuration lacks. If Geist introduces complexity, Inter with better weight and feature control is acceptable.

Enable `font-feature-settings: "tnum" 1` globally for elements displaying numbers. This ensures the elapsed timer in `ActiveRoomCard`, segment counts in `HistoryPanel`, and the countdown in `InterviewRoom` all use tabular (monospaced) numerals that don't shift layout as digits change.

**Type scale (base: 14px body, 4px grid):**

| Token | Size | Line height | Weight | Use |
|-------|------|-------------|--------|-----|
| `text-2xs` | 10px | 16px | 500 | Mute/camera badge in PiP, timestamps |
| `text-xs` | 11px | 16px | 500 | Tab labels, section header caps, metadata chips |
| `text-sm` | 13px | 20px | 400 | Body text in panels (transcript, notes, history) |
| `text-base` | 14px | 20px | 400 | Default body, input text, button labels |
| `text-lg` | 16px | 24px | 600 | Card titles, section headings, dashboard page headings |
| `text-xl` | 20px | 28px | 700 | Dashboard page `<h2>`, auth card titles |
| `text-2xl` | 24px | 32px | 700 | Auth page `<h1>` only |

No `text-3xl` outside of the login page logo. Avoid `text-sm font-semibold` + `text-sm font-medium` competing at the same size — use the scale deliberately.

**Mono:** Keep JetBrains Mono. Use only for: meeting IDs, room codes, channel names, elapsed timers, technical identifiers.

### Spacing and layout

Strict 4px grid. Define a spacing scale of: 4, 8, 12, 16, 20, 24, 32, 48, 64.

**Component internal padding:** 12px (panels, compact cards), 16px (standard cards), 24px (spacious cards — never `p-16`).

**Component gaps:** 8px (inline elements within a group), 12px (list items), 16px (distinct sections within a card).

**Section gaps:** 24px between major sections on a page.

**Page padding:** `px-6 py-6` on desktop, `px-4 py-4` on mobile.

**Max content widths:**
- Dashboard content: 960px (`max-w-4xl`) — tighter than the current `max-w-5xl`/`max-w-6xl`. Dashboards with a single primary action don't need that width.
- Auth cards: 400px (login), 480px (register).
- InterviewRoom: full-width flex, no max-width constraint.

### Component primitives

**Buttons — explicit 4-level hierarchy:**
- **Primary:** `bg-accent text-zinc-950` (dark text on amber background), `rounded-md` (6px), height 36px (desktop) / 40px (mobile touch), `font-medium text-base`. No gradient. No glow shadow. Hover: `bg-accent-hover`. No scale transform on click.
- **Secondary:** `bg-bg-2 border border-border-default text-text-primary`, `rounded-md`, same height. Hover: `bg-bg-3`.
- **Ghost:** No background, no border at rest, `text-text-secondary`. Hover: `bg-bg-2 text-text-primary`. For low-priority actions (logout, cancel, "upload a different file").
- **Destructive:** `bg-danger text-white`, `rounded-md`. No gradient. Used only for End Call, Delete Note.
- **Icon-only:** 32px square, `bg-bg-2 rounded-md`. No border at rest; border appears on hover (`border border-border-default`). Never `btn-icon` with `rounded-xl`.

The key discipline: **every page should have at most one primary button in view at a time.** If a page has two actions, one is primary, one is ghost. The dashboard "Join Interview" is primary; "History" is a ghost link. Auth pages: one primary "Sign In" / "Create Account" button — correct already, but the visual weight of the glass card competes.

**Inputs:**
- Height: 36px desktop, 40px mobile.
- `bg-bg-2 border border-border-default rounded-md px-3`.
- Focus: `border-accent outline-none` (no `ring` with blur, no `ring-primary-500/40`).
- Error state: `border-danger`.
- No `rounded-xl` on inputs. `rounded-md` reads as a form field; `rounded-xl` reads as a pill.

**Cards:**
- `bg-bg-1 border border-border-subtle rounded-lg` (8px radius).
- No backdrop blur. No gradient. No glow shadow.
- Hover state (for clickable cards): `border-border-default` (border brightens, no glow).
- Internal padding: 16px standard, 12px compact.

**Badges / status pills:**
- `rounded` (2px) or `rounded-sm` (4px) — never `rounded-full` or `rounded-lg`.
- `px-2 py-0.5 text-xs font-medium`.
- Success: `bg-success/12 text-success border border-success/20`.
- Warning: same with warning colors.
- Danger: same with danger colors.
- Neutral: `bg-bg-3 text-text-secondary border border-border-default`.

**Modals and overlays:**
- Scrim: `bg-zinc-950/70` (no backdrop-blur — blurring an already-dark background is invisible and wastes GPU).
- Modal card: `bg-bg-1 border border-border-default rounded-lg`, max-w-sm or max-w-md as appropriate.
- Entry: `animate-slide-up` at 200ms — keep this, it's appropriate.

**Section headers within panels:**
- No colored icon. Use a muted zinc icon (text-tertiary) or no icon at all.
- `text-xs font-medium text-text-secondary uppercase tracking-widest` — or drop the uppercase entirely and use `text-sm font-semibold text-text-primary`.
- Consistent border-bottom (`border-border-subtle`) as the divider.

### Motion

**Keep:**
- `animate-fade-in` (150ms ease-out): appropriate for page-level mounts, overlays, error banners.
- `animate-slide-up` (200ms ease-out): modal entry, terminated/interrupted overlay.
- `dot-pulse`: appropriate "waiting" indicator in the video area.
- `animate-pulse` on status dots: fine for indicating live connection.

**Remove:**
- `active:scale-[0.98]` on all buttons.
- `hover:shadow-primary-500/40` on buttons.
- `hover:shadow-xl hover:shadow-primary-500/5` on cards.

**Add:**
- Tab switching: **instant, no animation**. Tab content panels switch synchronously. In a fast-moving interview, delay on tab switch is irritating.
- Connection lost banner: `animate-slide-down` from top — replaces the current static div that appears in-flow.

---

## Step 4 — Mobile Responsiveness Plan

The app has no mobile layout. Every surface uses fixed-width flex ratios or large max-widths with no breakpoints below `md`. Specific breakages:

### InterviewRoom (`InterviewRoom.jsx`)

**Current:** `flex-[3] / flex-[2]` split (60/40), no breakpoints. On a 375px phone, each column would be ~225px and ~150px — completely unusable.

**Proposed mobile layout (below `md: 768px`):**

The layout becomes a vertically stacked single-column with a fixed tab bar at the bottom:

```
┌─────────────────────────────────┐
│  Header bar (logo + meeting ID) │ — 48px, no user name
├─────────────────────────────────┤
│                                 │
│   Video area                    │ — aspect-video (16:9), full width
│   (PiP overlay stays draggable) │   ≈ 211px on 375px screen
│                                 │
├─────────────────────────────────┤
│   Panel content area            │ — fills remaining height
│   (transcript / notes / etc.)   │
│                                 │
├─────────────────────────────────┤
│ [🎤] [📷]  [T] [N] [V] [H]  [✕]│ — 56px fixed bottom bar
└─────────────────────────────────┘
```

The bottom bar combines controls and tabs. Left side: mic toggle, camera toggle (icon-only, 40px touch targets). Center: tab icons (Transcript, Notes, Video, History) — no labels at small size, labels at `sm:`. Right: End call button (red, labeled "End").

The panel content area fills flexibly between the video and the bottom bar. No drawer or bottom sheet needed — the layout is simply a stacked column.

Supervisors on mobile: video area shows a single full-width remote tile (drop the side-by-side). The second participant goes into a PiP at top-right of the main tile.

**Breakpoint behavior:**
- Below `md`: single-column stacked layout with bottom control bar
- `md` and above: current 60/40 horizontal split, bottom controls bar (as today)

### InterviewerDashboard (`InterviewerDashboard.jsx`)

**Current issues on mobile:**
- Header: user name (`text-surface-100 font-medium`) + connection dot + Logout button all in a flex row. At 375px, this collapses — the logo + name on the left competes with three items on the right.
- Open rooms list: each `li` is a horizontal flex (`flex items-center justify-between`) with candidate name, wait label, History pill, and Join button. On mobile, this is 4 items in one row — either truncated or overflowing.

**Proposed behavior below `md`:**
- Header: Show only the RM icon, "RecruitMonitor" text, and a hamburger or the connection dot + logout. Drop the user name.
- Room list items: Stack vertically. Candidate name on line 1; wait label + History pill on line 2; full-width "Join Interview" primary button on line 3.
- Implementation: The current `flex items-center justify-between gap-4` row on the `li` becomes `flex-col gap-3` at mobile, with the button taking `w-full`.

### SupervisorDashboard (`SupervisorDashboard.jsx`)

Already has `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` — single column on mobile is correct. The remaining issues:
- The `MeetingCard` (`p-6`, fixed content) is fine at mobile width.
- Header has same issues as InterviewerDashboard — simplify on mobile.
- The "Live monitoring" indicator row can be hidden on mobile (redundant with the connection dot).

### CandidateWaitingRoom (`CandidateWaitingRoom.jsx`)

**Current issues:**
- Already mostly mobile-friendly: `max-w-md` card, `aspect-video` preview.
- Mic/cam toggle buttons at `px-4 py-2` give ≈ 32px touch targets — borderline. Should be 40px.
- The centered card layout with `py-12` wastes 96px of vertical space on mobile. At 375×667 (iPhone SE), this is significant.

**Proposed:**
- Remove `py-12` on mobile, use `py-4` or remove centering entirely.
- Below `sm:`: let the card go edge-to-edge (`rounded-none` or reduce to `rounded-lg` at the viewport edges), remove the outer padding.
- Increase mic/cam toggle button height to 40px (`py-2.5` minimum).

### Auth pages (Login, Register)

These are already the most mobile-friendly pages: centered card with `max-w-md`. Minor fixes:
- Reduce `py-12` to `py-4` on mobile.
- Register's role selector (`grid-cols-3`) becomes `grid-cols-1` at `xs:` and `grid-cols-3` from `sm:` up. Three role cards in a row at 375px is cramped.

### Pre-join controls (RoomControls, CandidateWaitingRoom)

`RoomControls.jsx` is currently `flex items-center justify-between px-6 py-4`. On mobile, the left group (mic + camera) and right (End Call) are at opposite ends of a narrow bar. Works, but:
- Increase `py-4` to `py-3` on mobile to reclaim height.
- The End Call button at `btn-danger` (which has `px-6 py-3`) shrinks to fit — add `min-w-[88px]` so label doesn't wrap.
- On mobile, mic and camera buttons already have sufficient touch area via `btn-icon p-3`.

---

## Step 5 — Prioritized Implementation Roadmap

### Phase 1 — Design tokens (no visual risk, foundational)

**What:** Replace the color palette, update the type scale reference, add spacing constants. This establishes the system all subsequent phases build on.

**Files to touch:**
1. `client/tailwind.config.js` — Replace `primary-*` with `accent-*` (amber scale). Replace `surface-*` with `zinc-*` (or rebrand the keys to `bg-*` / `text-*` / `border-*` semantic tokens). Add `font-feature-settings`. Update animation durations.
2. `client/src/index.css` — Rewrite the `@layer components` block: replace `.glass-card` with `.card`, `.glass-card-hover` with `.card-interactive`, update `.glass-input` to `.input`, update all button classes to remove gradients/glows/scale. Remove decorative blurred-orb classes if any are defined here.

**Order:** `tailwind.config.js` first (tokens), then `index.css` (utility classes that reference those tokens). After this phase, the app will look broken (existing components still reference old class names) until Phase 2 wires them up.

**Risk: Low.** Token changes don't affect behavior, only appearance. Rollback is a single file revert.

---

### Phase 2 — Component primitives

**What:** Update the small, stateless, reused building blocks that appear on every page. These establish the new visual language in practice before touching complex pages.

**Files to touch (in order):**
1. `client/src/components/ParticipantPanel.jsx` — Remove `glass-card`, use new `.card`. Simplest file in the codebase.
2. `client/src/components/RoomControls.jsx` — Update button classes, add mobile touch targets, remove `btn-danger` gradient.
3. `client/src/components/ActiveRoomCard.jsx` — Remove `glass-card-hover`, update status badges, fix button hierarchy.
4. `client/src/components/ErrorBoundary.jsx` — Audit for any hardcoded colors.

**Risk: Low.** These are presentational. No state, no sockets, no real-time concerns.

---

### Phase 3 — Auth flow (Login, Register)

**What:** The lowest-risk redesign candidates. Completely standalone. No real-time state, no sockets, no Agora.

**Changes:**
- Remove blurred-orb background decorations.
- Replace `glass-card` with `.card` (solid, no blur).
- Replace gradient logo icon with a flat accent-colored mark.
- Left-align the form within the card instead of centering the card content.
- Login: Left side becomes a narrow column with a subtle brand mark; form fills the card cleanly.
- Register: Role selector becomes a radio-style segment control (inline, not 3-column card grid).
- Add proper `aria-label` to close/dismiss buttons.
- Mobile: remove `py-12`, shrink role selector to vertical on `xs:`.

**Files to touch (in order):**
1. `client/src/pages/LoginPage.jsx`
2. `client/src/pages/RegisterPage.jsx`
3. `client/src/pages/CandidateJoinPage.jsx` (if it exists and shares the pattern)

**Risk: Very low.** Isolated pages, no shared state effects.

---

### Phase 4 — Dashboards and pre-join screens

**What:** The operational pages interviewers and supervisors use daily. More complex than auth (real-time socket state, live data) but no video/audio.

**Changes:**
- Headers: flatten the gradient logo icon to a flat amber mark. Simplify mobile header.
- Empty states: add a proper illustration or structured empty state component (icon + heading + description + optional action).
- Error banners: replace `✕` emoji with SVG close icon + `aria-label="Dismiss"`.
- InterviewerDashboard open rooms list: responsive stacking on mobile.
- SupervisorDashboard meeting cards: minor layout cleanup, no mobile changes needed beyond what the grid already provides.
- CandidateWaitingRoom: remove centering on mobile, increase toggle button touch targets.

**Files to touch (in order):**
1. `client/src/pages/CandidateWaitingRoom.jsx`
2. `client/src/pages/InterviewerDashboard.jsx`
3. `client/src/components/CandidateHistoryModal.jsx`
4. `client/src/pages/SupervisorDashboard.jsx`
5. `client/src/pages/CandidateJoinPage.jsx`

**Risk: Medium.** These pages have socket connections and real-time state. Visual-only changes are safe; be careful not to touch event registration or store updates. Test all four socket-connected states (connecting, connected, open rooms received, joining) after each file.

---

### Phase 5 — InterviewRoom and in-call panels (most complex, do last)

**What:** The core product experience. This is the most technically sensitive part of the codebase (Agora RTC, Socket.IO, TranscriptStore, concurrent state updates). The redesign risk here is incidentally breaking the real-time pipeline while touching JSX structure.

**Changes:**
- `VideoGrid.jsx`: Remove purple gradient avatar circles. Use flat zinc circle with initial. The PiP overlay removes `rounded-xl overflow-hidden border border-surface-600/50 shadow-xl` and uses a simpler `rounded-md border border-border-default`. Add mobile: supervisor gets single main tile + PiP instead of side-by-side.
- `TranscriptBox.jsx`: Tighten the section header (remove colored icon). Note input bar should use `.input` not the bespoke inline style. The `free-note` border (`border-l-2 border-primary-500/30`) becomes `border-l-2 border-accent/30`.
- `NotesPanel.jsx`: Note items change from `bg-surface-800/50 rounded-xl` to `.card` (solid, rounded-lg). Edit/delete icon buttons use new icon button style.
- `HistoryPanel.jsx`: Expand/collapse items update to use `.card`. Loading state gets a text label alongside the spinner. Empty state gets proper structure (icon + heading + sub).
- `VideoResumePanel.jsx`: All section labels get consistent styling. Upload button becomes a bordered upload zone (not just a text button). Supervisor empty state gets an icon.
- `InterviewRoom.jsx`: Add mobile breakpoint — below `md`, restructure to stacked video + panel + bottom tab-controls bar. Update overlay cards to use new modal styles. Fix the terminated countdown dot logic (should drain from 5 to 0, not fill).
- `RoomControls.jsx`: Already updated in Phase 2; Phase 5 only adds the mobile bottom bar fusion with the tab strip.

**Files to touch (in order):**
1. `client/src/components/VideoGrid.jsx`
2. `client/src/components/TranscriptBox.jsx`
3. `client/src/components/NotesPanel.jsx`
4. `client/src/components/HistoryPanel.jsx`
5. `client/src/components/VideoResumePanel.jsx`
6. `client/src/pages/InterviewRoom.jsx` (layout restructure + mobile breakpoint — save for last)

**Risk: High on InterviewRoom.jsx.** Any change to the JSX tree structure in `InterviewRoom` risks touching `useEffect` dependency arrays, `socket.on` registration, or the `startTransition` boundaries. Approach: make structural layout changes in a single diff, run the full socket/Agora flow manually before committing.

---

## Summary

| Phase | Files | Risk | Scope |
|-------|-------|------|-------|
| 1 — Tokens | `tailwind.config.js`, `index.css` | Low | Color, type, spacing system |
| 2 — Primitives | 4 small components | Low | Buttons, cards, controls |
| 3 — Auth | 2-3 pages | Very low | Login, Register, Candidate join |
| 4 — Dashboards | 5 pages/components | Medium | Interviewer, Supervisor, Waiting room |
| 5 — InterviewRoom | 6 components + 1 page | High | In-call UI, mobile layout |

Each phase is independently reviewable and deployable. Phases 1-3 can be shipped together. Phase 4 requires socket testing. Phase 5 requires a full call test (Agora + Deepgram + Socket.IO) before shipping.
