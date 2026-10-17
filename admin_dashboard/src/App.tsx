import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import { RequireManagement } from './components/RequireManagement';
import LoginPage from './pages/LoginPage';
import PlaceholderPage from './pages/PlaceholderPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import RoutesPage from './pages/RoutesPage';
import StopPointsPage from './pages/StopPointsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireManagement />}>
        <Route element={<DashboardLayout />}>
          <Route path="/events" element={<EventsPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/routes" element={<RoutesPage />} />
          <Route path="/stop-points" element={<StopPointsPage />} />
          <Route path="/live-map" element={<PlaceholderPage title="Live Map" detail="Live GPS arrives in later tracking phases." />} />
          <Route path="/groups" element={<PlaceholderPage title="Groups" detail="Group management begins in Phase 20." />} />
          <Route path="/access-codes" element={<PlaceholderPage title="Access Codes" detail="Access code generation comes in Phase 22." />} />
          <Route path="/alerts" element={<PlaceholderPage title="Alerts" detail="Alerts will appear in later phases." />} />
          <Route path="/users" element={<PlaceholderPage title="Users" detail="User management is restricted to later admin workflows." />} />
          <Route path="/settings" element={<PlaceholderPage title="Settings" detail="Dashboard settings are not implemented yet." />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/events" replace />} />
    </Routes>
  );
}