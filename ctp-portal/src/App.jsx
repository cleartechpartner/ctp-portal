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
    if (!session) { setProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data, error }) => {
        if (error) { console.error('Profile fetch error:', error); setAuthError('Could not load profile: ' + error.message); setSession(null); }
        else setProfile(data || null);
      });
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
              <Route path="/sign" element={<Sign />} />
              <Route path="/sign/new" element={<SignPrepare />} />
              <Route path="/sign/:id" element={<SignDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        ) : (
          <Shell profile={profile}>
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
