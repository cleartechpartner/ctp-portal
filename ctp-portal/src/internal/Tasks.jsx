import TaskPanel from './TaskPanel';

export default function Tasks({ profile }) {
  return (
    <div className="page">
      <div className="co-header">
        <div>
          <h1>Tasks</h1>
        </div>
      </div>
      <TaskPanel profile={profile} />
    </div>
  );
}
