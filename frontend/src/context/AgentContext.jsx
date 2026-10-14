// Remembers which agent the app is acting as and whether the Agent or Tester view is on, for every page. Owner: Virun.
// Both choices are kept in the browser (localStorage) so a reload keeps them. Uses GET /api/lookups/agents; if that list
// can't be loaded, the header falls back to typing an agent ID.
// Remembers which agent the app is acting as and whether the Agent or Tester view is on, and keeps both in the browser so a reload does not lose them.
// An agent who signed in always acts as themselves in the Agent view; only an admin chooses the agent and the view.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setTesterMode } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const AgentContext = createContext(null);
const AGENT_KEY = 'mims.agentId';
const VIEW_KEY = 'mims.viewMode';

// localStorage can be missing or blocked (private windows, strict settings), so every use is wrapped in try/catch.
function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // nothing to do: the choice still works until the page is reloaded
  }
}

export function AgentProvider({ children }) {
  const { user } = useAuth();
  const agentLogin = user?.role === 'AGENT';
  const [agents, setAgents] = useState([]);
  const [agentsError, setAgentsError] = useState(null);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [chosenAgentId, setAgentIdState] = useState(() => Number(readStored(AGENT_KEY)) || null);
  // An admin starts in the Tester view unless they switched to the Agent view before
  const [chosenView, setViewModeState] = useState(() => (readStored(VIEW_KEY) === 'agent' ? 'agent' : 'tester'));
  const agentId = agentLogin ? user.agentId : chosenAgentId;
  const viewMode = agentLogin ? 'agent' : chosenView;

  // Set during render, not in an effect, so the very first requests of a page already carry the Tester header.
  setTesterMode(viewMode === 'tester');

  const setAgentId = useCallback((id) => {
    const value = Number(id) || null;
    setAgentIdState(value);
    writeStored(AGENT_KEY, value ? String(value) : '');
  }, []);

  const setViewMode = useCallback((mode) => {
    const value = mode === 'tester' ? 'tester' : 'agent';
    setViewModeState(value);
    writeStored(VIEW_KEY, value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/lookups/agents')
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        // Keep the remembered agent if it is still active; otherwise start with the first one in the list.
        setAgentIdState((current) => {
          const stillThere = list.some((a) => a.agentId === current);
          const chosen = stillThere ? current : list[0]?.agentId ?? null;
          writeStored(AGENT_KEY, chosen ? String(chosen) : '');
          return chosen;
        });
      })
      .catch((error) => !cancelled && setAgentsError(error.message))
      .finally(() => !cancelled && setAgentsLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      agents,
      agentsError,
      agentsLoading,
      agentId,
      agent: agents.find((a) => a.agentId === agentId) ?? null,
      setAgentId,
      viewMode,
      setViewMode,
      isTester: viewMode === 'tester',
      canChoose: !agentLogin, // the "Acting as" list and the Agent/Tester switch are for admins
    }),
    [agents, agentsError, agentsLoading, agentId, setAgentId, viewMode, setViewMode, agentLogin],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) throw new Error('useAgent must be used inside <AgentProvider>');
  return context;
}
