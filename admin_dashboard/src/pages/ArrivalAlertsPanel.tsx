import { useRecords } from '../lib/records';
import QueryFeedback from '../components/QueryFeedback';
import type { Timestamp } from 'firebase/firestore';
type ArrivalNotificationRecord = { id: string; eventId: string; groupId: string; stopPointId: string; message: string; createdAt: Timestamp };
export default function ArrivalAlertsPanel({ eventId }: { eventId: string }) {
  const alerts = useRecords<ArrivalNotificationRecord>('arrivalNotifications', 'eventId', eventId);
  return <section className="panel"><h3>Stop Arrival Notifications</h3>
    <QueryFeedback state={alerts} />
    {!alerts.loading && !alerts.error && alerts.items.length === 0 && <p>No confirmed arrivals.</p>}
    {alerts.items.map(item => <div className="item" key={item.id}><span>{item.message} · {item.createdAt?.toDate?.().toLocaleString() ?? 'Pending'}</span></div>)}
  </section>;
}
