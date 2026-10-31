import { useRecords } from '../lib/records';
import type { Timestamp } from 'firebase/firestore';
type ArrivalNotificationRecord = { id: string; eventId: string; groupId: string; stopPointId: string; message: string; createdAt: Timestamp };
export default function ArrivalAlertsPanel({ eventId }: { eventId: string }) {
  const alerts = useRecords<ArrivalNotificationRecord>('arrivalNotifications', 'eventId', eventId);
  return <section className="panel"><h3>Stop Arrival Notifications</h3>
    {alerts.loading && <p>Loading arrivals...</p>}
    {alerts.error && <p role="alert" className="error">{alerts.error}</p>}
    {!alerts.loading && alerts.items.length === 0 && <p>No confirmed arrivals.</p>}
    {alerts.items.map(item => <div className="item" key={item.id}><span>{item.message} · {item.createdAt?.toDate?.().toLocaleString() ?? 'Pending'}</span></div>)}
  </section>;
}