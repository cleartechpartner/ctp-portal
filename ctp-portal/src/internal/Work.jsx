import { Link, Navigate, useParams } from 'react-router-dom';
import Tasks from './Tasks';
import Time from './Time';

// Tab wrapper only. The wrapped pages are mounted as-is and keep their own
// headers; this adds nothing but the tab bar (same pattern as the Time page).
const TABS = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'time', label: 'Time' }
];

export default function Work({ profile }) {
  const { tab } = useParams();
  if (!TABS.some(t => t.id === tab)) return <Navigate to="/work/tasks" replace />;

  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <div className="tt-tabs no-print" style={{ marginBottom: 0 }}>
          {TABS.map(t => (
            <Link key={t.id} to={`/work/${t.id}`} className={'tt-tab' + (tab === t.id ? ' on' : '')}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      {tab === 'tasks' ? <Tasks profile={profile} /> : <Time />}
    </>
  );
}
