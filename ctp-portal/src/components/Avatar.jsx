// Shared initials-circle avatar used across the portal (account area, etc.).
// Falls back to initials when no photo is set — same look as .co-avatar.
export function initialsOf(name, email) {
  const src = (name || (email ? email.split('@')[0] : '') || '').trim();
  if (!src) return '?';
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function Avatar({ profile, size = 28 }) {
  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt={profile.full_name || 'Avatar'}
        className="co-avatar"
        style={{ width: size, height: size, objectFit: 'cover' }}
      />
    );
  }
  const fs = Math.max(9, Math.round(size * 0.36));
  return (
    <div className="co-avatar" style={{ width: size, height: size, fontSize: fs }}>
      {initialsOf(profile?.full_name, profile?.email)}
    </div>
  );
}
