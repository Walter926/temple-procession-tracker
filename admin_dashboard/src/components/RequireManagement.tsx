import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../context/AuthContext';

export function RequireManagement() {
  const { user, role } = useSession();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (role !== 'admin' && role !== 'organizer') {
    return (
      <main className="content">
        <h1>Access Denied</h1>
        <p>You do not have permission to access the management dashboard.</p>
      </main>
    );
  }

  return <Outlet />;
}

export default RequireManagement;