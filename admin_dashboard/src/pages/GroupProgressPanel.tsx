import type { Timestamp } from 'firebase/firestore';
export type ProgressRecord = { id: string; eventId: string; groupId: string; currentStopPointId: string; nextStopPointId: string; currentSegmentId: string; completedCount: number; totalStops: number; progressPercent: number; isDelayed: boolean; estimatedArrivalAt: Timestamp | null; lastComputedAt: Timestamp | null };
export default function GroupProgressPanel({ progress }: { progress?: ProgressRecord }) {
  if (!progress) return <section className="panel"><h3>Route Progress</h3><p>No confirmed GPS progress yet.</p></section>;
  const percent = Math.max(0, Math.min(100, progress.progressPercent || 0));
  return <section className="panel"><h3>Route Progress</h3>
    <progress max={100} value={percent} style={{ width: '100%' }} />
    <p>{percent.toFixed(1)}% · {progress.completedCount}/{progress.totalStops} stops completed</p>
    <p>Nearest segment: {progress.currentSegmentId || 'Not determined'} · Next stop: {progress.nextStopPointId || 'None'}</p>
    <p>Estimated next-stop arrival: {progress.estimatedArrivalAt?.toDate().toLocaleString() ?? 'Unavailable (not moving)'}</p>
    <p>Last calculated: {progress.lastComputedAt?.toDate().toLocaleString() ?? 'Never'}</p>
    {progress.isDelayed && <p role="alert" className="error">Behind planned schedule</p>}
    <p className="subtle">ETA uses straight-line distance and reported speed, not road directions.</p>
  </section>;
}   