import TaskPanel from './TaskPanel';

export default function Tasks({ profile }) {
  return (
    <div className="page">
      <TaskPanel profile={profile} />
    </div>
  );
}
