import { Link, Navigate, useParams } from 'react-router-dom';
import Sign from './Sign';
import Proposals from './Proposals';

// Tab wrapper only. The wrapped pages are mounted as-is and keep their own
// headers; this adds nothing but the tab bar (same pattern as the Time page).
const TABS = [
  { id: 'contracts', label: 'Contracts' },
  { id: 'proposals', label: 'Proposals' }
];

export default function Paperwork() {
  const { tab } = useParams();
  if (!TABS.some(t => t.id === tab)) return <Navigate to="/paperwork/contracts" replace />;

  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <div className="tt-tabs no-print" style={{ marginBottom: 0 }}>
          {TABS.map(t => (
            <Link key={t.id} to={`/paperwork/${t.id}`} className={'tt-tab' + (tab === t.id ? ' on' : '')}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      {tab === 'contracts' ? <Sign /> : <Proposals />}
    </>
  );
}
