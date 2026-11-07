import { Navigate, Route, Routes } from 'react-router-dom';
import DashboardLayout from './components/DashboardLayout';
import { RequireManagement } from './components/RequireManagement';
import LoginPage from './pages/LoginPage';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import RoutesPage from './pages/RoutesPage';
import StopPointsPage from './pages/StopPointsPage';
import GroupsPage from './pages/GroupsPage';
import AccessCodesPage from './pages/AccessCodesPage';
import AnnouncementsPage from './pages/AnnouncementsPage';

import AlertsPage from './pages/AlertsPage';
import RouteSuggestionsPage from './pages/RouteSuggestionsPage';
import LiveMapPage from './pages/LiveMapPage';
import NotificationsPage from './pages/NotificationsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
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
      <Route path="/announcements" element={<AnnouncementsPage />} />
      <Route path="/live-map" element={<LiveMapPage />} />
      <Route path="/alerts" element={<AlertsPage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
      <Route path="/route-suggestions" element={<RouteSuggestionsPage />} />
      <Route path="/users" element={<UsersPage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </Route></Route>
    <Route path="*" element={<Navigate to="/events" replace />} />
  </Routes>;
}