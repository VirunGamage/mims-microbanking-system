// Chooses what the browser shows: the public start page until someone signs in, then online banking for a customer,
// or the branch screens for an agent or an admin (the admin also gets the Tester view).
import App from './App.jsx';
import Loading from './components/Loading.jsx';
import { AgentProvider } from './context/AgentContext.jsx';
import { useAuth } from './context/AuthContext.jsx';
import CustomerApp from './customer/CustomerApp.jsx';
import Landing from './landing/Landing.jsx';

export default function Root() {
  const { user, checking } = useAuth();
  if (checking) {
    return (
      <div className="splash">
        <Loading label="Opening B-Trust…" />
      </div>
    );
  }
  if (!user) return <Landing />;
  if (user.role === 'CUSTOMER') return <CustomerApp />;
  return (
    <AgentProvider>
      <App />
    </AgentProvider>
  );
}
