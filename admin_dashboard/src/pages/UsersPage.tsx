import { useState } from 'react';
import { useSession } from '../context/AuthContext';
import { useRecords } from '../lib/records';
import type { ManagementUserRecord } from '../types/domain';
export default function UsersPage() {
  const users = useRecords<ManagementUserRecord>('users'), { role } = useSession();
  const [filter, setFilter] = useState('');
  if (role !== 'admin') return <p>User management is restricted to administrators.</p>;
  const shown = users.items.filter(u => `${u.displayName} ${u.email} ${u.role}`.toLowerCase().includes(filter.toLowerCase()));
  return <div><h1>User Management</h1><section className="panel"><label>Search users<input value={filter} onChange={e => setFilter(e.target.value)} /></label></section>
    {users.error && <p role="alert" className="error">{users.error}</p>}
    <section className="panel"><h2>Accounts ({shown.length})</h2>{shown.map(u => <div className="item" key={u.id}><span>{u.displayName} · {u.email} · {u.role} · {u.isActive ? 'Active' : 'Inactive'}</span></div>)}</section>
    <p>Account role and activation changes require a verified trusted administration workflow. This page intentionally does not expose client-side role editing.</p>
  </div>;
}