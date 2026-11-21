import { signOut } from 'firebase/auth';
import { NavLink, Outlet } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { useSession } from '../context/AuthContext';
const pages = [
  { to: '/events', label: 'Events' }, { to: '/live-map', label: 'Live map' },
  { to: '/groups', label: 'Groups' }, { to: '/routes', label: 'Routes' },
  { to: '/stop-points', label: 'Stop points' }, { to: '/access-codes', label: 'Access codes' },
  { to: '/announcements', label: 'Announcements' }, { to: '/alerts', label: 'Collision alerts' },
  { to: '/route-suggestions', label: 'Route suggestions' }, { to: '/users', label: 'Users' },
];
export default function DashboardLayout() {
  const { user, role } = useSession();
  return <div className="layout"><a className="skip-link" href="#main-content">Skip to content</a><aside className="sidebar">
    <div className="brand"><img className="brand-logo" src="/temple-icon.png" alt="" /><div><h2>Temple Tracker</h2><p className="subtle">Management</p></div></div>
    <nav aria-label="Management navigation">{pages.filter(page => page.to !== '/users' || role === 'admin').map(page => <NavLink key={page.to} to={page.to} className={({ isActive }) => isActive ? 'active' : ''}>{page.label}</NavLink>)}</nav>
  </aside><div className="workspace"><header className="topbar"><span>{user?.email} <span className="badge">{role}</span></span><button onClick={() => void signOut(auth)}>Sign out</button></header>
    <main id="main-content" className="content" tabIndex={-1}><Outlet /></main></div></div>;
}
