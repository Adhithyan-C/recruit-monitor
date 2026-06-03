import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore.js';
import { useRoomStore } from './store/useRoomStore.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import LoginPage from './pages/LoginPage.jsx';
import InterviewerDashboard from './pages/InterviewerDashboard.jsx';
import SupervisorDashboard from './pages/SupervisorDashboard.jsx';
import CandidateWaitingRoom from './pages/CandidateWaitingRoom.jsx';
import InterviewRoom from './pages/InterviewRoom.jsx';
import RegisterPage from './pages/RegisterPage.jsx';

function ProtectedRoute({ children, requiredRole }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (requiredRole && user?.role !== requiredRole) return <Navigate to="/" replace />;

  return children;
}

function RoomGuard({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const roomId = useRoomStore((s) => s.roomId);
  const { roomId: paramRoomId } = useParams();

  if (!isAuthenticated && roomId !== paramRoomId) {
    return <Navigate to="/join" replace />;
  }

  return children;
}

// Gates all route rendering until the auth store has been hydrated.
// rehydrate() runs synchronously at module load in useAuthStore.js, so for a
// valid stored token hydrated is already true before the first render — no
// spinner shown. The spinner only appears during an async token refresh.
function AppInit({ children }) {
  const hydrated = useAuthStore((s) => s.hydrated);

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInit>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/candidate"
            element={
              <ProtectedRoute requiredRole="candidate">
                <CandidateWaitingRoom />
              </ProtectedRoute>
            }
          />
          <Route
            path="/interviewer"
            element={
              <ProtectedRoute requiredRole="interviewer">
                <InterviewerDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/supervisor"
            element={
              <ProtectedRoute requiredRole="supervisor">
                <SupervisorDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/room/:roomId"
            element={
              <RoomGuard>
                <ErrorBoundary>
                  <InterviewRoom />
                </ErrorBoundary>
              </RoomGuard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppInit>
    </BrowserRouter>
  );
}
