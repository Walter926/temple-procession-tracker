import { Navigate, Outlet } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { useSession } from '../context/AuthContext';
import { auth } from '../lib/firebase';

export function RequireManagement() {
  const { user, role, isActive, loading, error } = useSession();
  if (loading) return <main className="center">Checking account permissions...</main>;
  if (error) return <main className="center" role="alert">Unable to verify role: {error}</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!isActive || (role !== 'admin' && role !== 'organizer')) return <main className="center" role="alert">
    <div><p>Access denied. An active Administrator or Organizer account is required.</p><button onClick={() => void signOut(auth)}>Sign Out</button></div>
  </main>;
  return <Outlet />;
}