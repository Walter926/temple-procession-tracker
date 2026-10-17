import { useState, type FormEvent } from 'react';
import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { Navigate } from 'react-router-dom';
import { auth } from '../lib/firebase';
import { useSession } from '../context/AuthContext';

export default function LoginPage() {
  const { user, role, isActive, loading } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      console.log('Firebase Authentication: Sign-in successful.');
    } catch (reason: unknown) {
      if (reason instanceof FirebaseError) {
        console.error('Firebase Authentication error:', reason.code, reason.message);
        setError(`Firebase login failed: ${reason.code}`);
      } else {
        console.error('Unexpected login error:', reason);
        setError('An unexpected login error occurred.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!loading && user && isActive && (role === 'admin' || role === 'organizer')) {
    return <Navigate to="/events" replace />;
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>Temple Procession Tracker</h1>
        <p>Management Dashboard</p>

        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        <label>
          Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error && <p className="error" role="alert">{error}</p>}

        <button disabled={busy} type="submit">
          {busy ? 'Signing in...' : 'Sign In'}
        </button>

        {user && !loading && (!isActive || (role !== 'admin' && role !== 'organizer')) && (
          <>
            <p className="error">This account is inactive or has no dashboard access.</p>
            <button type="button" onClick={() => void signOut(auth)}>Sign Out</button>
          </>
        )}
      </form>
    </main>
  );
}