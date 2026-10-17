import { signOut } from 'firebase/auth';
import { NavLink, Outlet } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { useSession } from '../context/AuthContext';

const pages = [
  { to: '/events', label: 'Events' }, { to: '/live-map', label: 'Live Map' },
  { to: '/groups', label: 'Groups' }, { to: '/routes', label: 'Routes' },
  { to: '/stop-points', label: 'Stop Points' }, { to: '/access-codes', label: 'Access Codes' },
  { to: '/alerts', label: 'Alerts' }, { to: '/users', label: 'Users' },
  { to: '/settings', label: 'Settings' },
];

export default function DashboardLayout() {
  const { user, role } = useSession();
  return <div className="layout">
    <aside className="sidebar"><h2>Temple Tracker</h2><p className="subtle">Management</p>
      <nav aria-label="Dashboard sidebar">{pages.map((page) => <NavLink key={page.to} to={page.to} className={({ isActive }) => isActive ? 'active' : ''}>{page.label}</NavLink>)}</nav>
    </aside>
    <div className="workspace"><header className="topbar"><span>{user?.email} · {role}</span><button onClick={() => void signOut(auth)}>Sign Out</button></header>
      <section className="content"><Outlet /></section>
    </div>
  </div>;
}