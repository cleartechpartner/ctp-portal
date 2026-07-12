import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { LangProvider } from './lib/i18n';
import Login from './components/Login';
import Welcome from './components/Welcome';
import Shell from './components/Shell';
import InternalHome from './internal/InternalHome';
import ClientDetail from './internal/ClientDetail';
import Studio from './internal/Studio';
import Settings from './internal/Settings';
import Time from './internal/Time';
import ClientHome from './client/ClientHome';
import Reports from './client/Reports';
import Updates from './client/Updates';
import Documents from './client/Documents';
import Profile from './client/Profile';
import Sign from './internal/Sign';
import SignPrepare from './internal/SignPrepare';
import SignDetail from './internal/SignDetail';
import SignerView from './sign/SignerView';

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [clientLinks, setClientLinks] = useState([]); // profile_clients rows with client names
  const [authError, setAuthError] = useState(null);
  const [pwRecovery, setPwRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) { console.error('getSession error:', error); setAuthError(error.message); setSession(null); }
      else setSession(data.session ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      if (event === 'PASSWORD_RECOVERY') setPwRecovery(true);
      if (event === 'SIGNED_OUT') { setProfile(null); setPwRecovery(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); setClientLinks([]); return; }
    (async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (error) {
        console.error('Profile fetch error:', error);
        setAuthError('Could not load profile: ' + error.message);
        setSession(null);
        return;
      }
      // Which clients this profile can access (multi-client switcher).
      // Fails soft: before the multi-client migration runs, the table does
      // not exist and single-client behaviour continues unchanged.
      if (data?.role === 'client') {
        const { data: links, error: linkErr } = await supabase
          .from('profile_clients')
          .select('client_id, clients(id, name)')
          .eq('profile_id', session.user.id);
        if (linkErr) console.error('profile_clients fetch error:', linkErr);
        setClientLinks(linkErr ? [] : (links || []));
      } else {
        setClientLinks([]);
      }
      setProfile(data || null);
    })();
  }, [session?.user?.id]);

  // Public signer route: tokenised link from the signature email. Registered
  // outside the auth gate on purpose — no session, no Shell, no login.
  if (window.location.pathname.startsWith('/esign/')) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/esign/:token" element={<SignerView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (session === undefined || (session && !profile)) {
    return <div className="center"><div className="sp" /></div>;
  }

  // Invite links land here with a session but the user still needs a password.
  const needsWelcome = session && (pwRecovery || window.location.pathname === '/welcome');

  return (
    <LangProvider initial={profile?.language || 'en'}>
      <BrowserRouter>
        {!session ? (
          <Routes>
            <Route path="*" element={<Login authError={authError} />} />
          </Routes>
        ) : needsWelcome ? (
          <Routes>
            <Route path="*" element={<Welcome onDone={() => { setPwRecovery(false); window.history.replaceState({}, '', '/'); }} />} />
          </Routes>
        ) : profile.role === 'internal' ? (
          <Shell profile={profile} internal>
            <Routes>
              <Route path="/" element={<InternalHome />} />
              <Route path="/clients/:id" element={<ClientDetail profile={profile} />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/time" element={<Time />} />
              <Route path="/sign" element={<Sign />} />
              <Route path="/sign/new" element={<SignPrepare />} />
              <Route path="/sign/:id" element={<SignDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        ) : (
          <Shell profile={profile} clientLinks={clientLinks}>
            <Routes>
              <Route path="/" element={<ClientHome profile={profile} />} />
              <Route path="/reports" element={<Reports profile={profile} />} />
              <Route path="/updates" element={<Updates profile={profile} />} />
              <Route path="/documents" element={<Documents profile={profile} />} />
              <Route path="/profile" element={<Profile profile={profile} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        )}
      </BrowserRouter>
    </LangProvider>
  );
}
