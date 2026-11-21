import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import { RequireManagement } from './components/RequireManagement';
import LoginPage from './pages/LoginPage';
const EventsPage = lazy(() => import('./pages/EventsPage'));
const EventDetailPage = lazy(() => import('./pages/EventDetailPage'));
const RoutesPage = lazy(() => import('./pages/RoutesPage'));
const StopPointsPage = lazy(() => import('./pages/StopPointsPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const AccessCodesPage = lazy(() => import('./pages/AccessCodesPage'));
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const LiveMapPage = lazy(() => import('./pages/LiveMapPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const RouteSuggestionsPage = lazy(() => import('./pages/RouteSuggestionsPage'));

export default function App() {
  return <Suspense fallback={<main className="center" role="status">Loading dashboard…</main>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireManagement />}><Route element={<DashboardLayout />}>
      <Route path="/events" element={<EventsPage />} />
      <Route path="/events/:eventId" element={<EventDetailPage />} />
      <Route path="/routes" element={<RoutesPage />} />
      <Route path="/stop-points" element={<StopPointsPage />} />
      <Route path="/groups" element={<GroupsPage />} />
      <Route path="/access-codes" element={<AccessCodesPage />} />
      <Route path="/announcements" element={<AnnouncementsPage />} />
      <Route path="/live-map" element={<LiveMapPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="/route-suggestions" element={<RouteSuggestionsPage />} />
      <Route path="/settings" element={<Navigate to="/events" replace />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/events" replace />} />
  </Routes></Suspense>;
}
