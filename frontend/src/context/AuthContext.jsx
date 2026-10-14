// Who is signed in: a customer (online banking), an agent (the branch screens) or an admin (the Tester view).
// Asks the server once when the app opens (GET /api/auth/me), and forgets the user when any request answers 401
// (the session ran out), so the start page comes back.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn as requestSignIn, signOut as requestSignOut, whoAmI } from '../api/auth.js';
import { onSignedOut } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    whoAmI()
      .then((me) => !cancelled && setUser(me))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => onSignedOut(() => setUser(null)), []);

  const signIn = useCallback(
    async (form) => {
      const me = await requestSignIn(form);
      setUser(me);
      navigate('/', { replace: true }); // every kind of login starts on its own home page
      return me;
    },
    [navigate],
  );

  const signOut = useCallback(async () => {
    try {
      await requestSignOut();
    } finally {
      setUser(null);
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const value = useMemo(() => ({ user, checking, signIn, signOut }), [user, checking, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
