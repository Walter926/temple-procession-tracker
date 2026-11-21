import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useSession } from '../context/AuthContext';
import { useRecords } from '../lib/records';
import { callManagement, errorMessage } from '../lib/management';
import QueryFeedback from '../components/QueryFeedback';
import type { ManagementUserRecord } from '../types/domain';

const roles = ['admin', 'organizer', 'teamLeader', 'teamMember'];
export default function UsersPage() {
  const { role } = useSession();
  return role === 'admin' ? <Accounts /> : <Navigate to="/events" replace />;
}
function Accounts() {
  const users = useRecords<ManagementUserRecord>('users');
  const { user } = useSession();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<ManagementUserRecord | null | undefined>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  async function remove(account: ManagementUserRecord) {
    if (!window.confirm(`Remove ${account.email}? This removes the login and profile and cleans up assignments and memberships. This cannot be undone.`)) return;
    setBusyId(account.id); setError(''); setNotice('');
    try { await callManagement('manageAccount', { operation: 'delete', uid: account.id }); setNotice('Account removed.'); if (editing?.id === account.id) setEditing(undefined); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusyId(''); }
  }
  const visible = users.items.filter(u => `${u.displayName} ${u.email} ${u.role}`.toLowerCase().includes(filter.toLowerCase()));
  return <div><h1>Users</h1><p className="subtle">Administrator-only account management. Roles, account status and membership cleanup are validated on the server.</p>
    <div className="actions"><button onClick={() => setEditing(null)}>Create account</button></div>
    {editing !== undefined && <AccountForm key={editing?.id ?? 'new'} account={editing} selfId={user?.uid ?? ''} onCancel={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); setNotice('Account saved.'); }} />}
    <section className="panel"><label>Filter loaded accounts<input type="search" value={filter} onChange={e => setFilter(e.target.value)} /></label><QueryFeedback state={users} />
      {!users.loading && !visible.length && <p>No matching accounts.</p>}
      <div className="list">{visible.map(account => <article className="item" key={account.id}><div><strong>{account.displayName || account.email}</strong><p>{account.email}</p><p>{account.role} · {account.isActive ? 'Active' : 'Inactive'}{account.id === user?.uid ? ' · You' : ''}</p></div>
        <div className="actions"><button onClick={() => setEditing(account)}>Edit</button><button className="danger" disabled={!!busyId || account.id === user?.uid} onClick={() => void remove(account)}>{busyId === account.id ? 'Removing…' : 'Remove'}</button></div>
      </article>)}</div>
    </section>{error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
function AccountForm({ account, selfId, onSaved, onCancel }: { account: ManagementUserRecord | null; selfId: string; onSaved: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState(account?.email ?? '');
  const [name, setName] = useState(account?.displayName ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(account?.role ?? 'teamMember');
  const [isActive, setIsActive] = useState(account?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const self = account?.id === selfId;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await callManagement('manageAccount', { operation: account ? 'update' : 'create', ...(account ? { uid: account.id } : {}), email: email.trim(), displayName: name.trim(), role, isActive, ...(password ? { password } : {}) });
      setPassword(''); onSaved();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <form className="panel" onSubmit={submit}><h2>{account ? 'Edit account' : 'Create account'}</h2><div className="form-grid">
    <label>Display name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Email<input required type="email" autoComplete="off" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>Role<select disabled={self} value={role} onChange={e => setRole(e.target.value)}>{roles.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
    <label>{account ? 'New password (optional)' : 'Initial password'}<input required={!account} type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>
    <label className="inline"><input type="checkbox" disabled={self} checked={isActive} onChange={e => setIsActive(e.target.checked)} />Account active</label>
  </div><p className="subtle">Deactivation or a role change revokes existing publishing access. Memberships and leader assignments cannot be set here.</p>
    {self && <p>To change your own administrator role or deactivate your account, use a different administrator account.</p>}
    {error && <p className="error" role="alert">{error}</p>}<div className="actions"><button disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
