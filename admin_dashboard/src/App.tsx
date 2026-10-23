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
import AccessCodesPage from './pages/AccessCodesPage';

export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireManagement />}><Route element={<DashboardLayout />}>
      <Route path="/events" element={<EventsPage />} />
      <Route path="/events/:eventId" element={<EventDetailPage />} />
      <Route path="/routes" element={<RoutesPage />} />
      <Route path="/stop-points" element={<StopPointsPage />} />
      <Route path="/groups" element={<GroupsPage />} />
      <Route path="/access-codes" element={<AccessCodesPage />} />
      <Route path="/live-map" element={<PlaceholderPage title="Live Map" detail="Real-time map aggregation will be added in a later phase." />} />
      <Route path="/alerts" element={<PlaceholderPage title="Alerts" detail="Alert management comes later." />} />
      <Route path="/users" element={<PlaceholderPage title="Users" detail="Role changes require trusted administration." />} />
      <Route path="/settings" element={<PlaceholderPage title="Settings" detail="Settings come later." />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/events" replace />} />
  </Routes>;
}