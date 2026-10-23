import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import { RequireManagement } from './components/RequireManagement';
import LoginPage from './pages/LoginPage';
import PlaceholderPage from './pages/PlaceholderPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import RoutesPage from './pages/RoutesPage';
import StopPointsPage from './pages/StopPointsPage';
import GroupsPage from './pages/GroupsPage';

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireManagement />}><Route element={<DashboardLayout />}>
      <Route path="/events" element={<EventsPage />} />
      <Route path="/events/:eventId" element={<EventDetailPage />} />
      <Route path="/routes" element={<RoutesPage />} />
      <Route path="/stop-points" element={<StopPointsPage />} />
      <Route path="/groups" element={<GroupsPage />} />
      <Route path="/live-map" element={<PlaceholderPage title="Live Map" detail="Live group tracking comes in later phases." />} />
      <Route path="/access-codes" element={<PlaceholderPage title="Access Codes" detail="Access code management comes in Phase 22." />} />
      <Route path="/alerts" element={<PlaceholderPage title="Alerts" detail="Alert management comes in later phases." />} />
      <Route path="/users" element={<PlaceholderPage title="Users" detail="Role administration is reserved for a later phase." />} />
      <Route path="/settings" element={<PlaceholderPage title="Settings" detail="Settings will be implemented later." />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/events" replace />} />
  </Routes>;
}