import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface SessionState { user: User | null; role: string | null; isActive: boolean; loading: boolean; error: string | null }
const AuthContext = createContext<SessionState>({ user: null, role: null, isActive: false, loading: true, error: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopProfile: (() => void) | undefined;
    const stopAuth = onAuthStateChanged(auth, (nextUser) => {
      stopProfile?.();
      stopProfile = undefined;
      setUser(nextUser);
      setRole(null);
      setIsActive(false);
      setError(null);
      if (!nextUser) { setLoading(false); return; }
      setLoading(true);
      stopProfile = onSnapshot(doc(db, 'users', nextUser.uid), (snapshot) => {
        const data = snapshot.data();
        setRole(typeof data?.role === 'string' ? data.role : null);
        setIsActive(data?.isActive === true);
        setLoading(false);
      }, (reason) => { setRole(null); setIsActive(false); setError(reason.message); setLoading(false); });
    }, (reason) => { setRole(null); setIsActive(false); setError(reason.message); setLoading(false); });
    return () => { stopProfile?.(); stopAuth(); };
  }, []);

  return <AuthContext.Provider value={{ user, role, isActive, loading, error }}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useSession must be used inside AuthProvider');
  return context;
}
