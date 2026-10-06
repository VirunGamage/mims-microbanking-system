// Remembers which agent the app is acting as and whether the Agent or Tester view is on, for every page. Owner: Virun.
// Both choices are kept in the browser (localStorage) so a reload keeps them. Uses GET /api/lookups/agents; if that list
// can't be loaded, the header falls back to typing an agent ID.
// Remembers which agent the app is acting as and whether the Agent or Tester view is on, and keeps both in the browser so a reload does not lose them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setTesterMode } from '../api/client.js';

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
  const [agents, setAgents] = useState([]);
  const [agentsError, setAgentsError] = useState(null);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentId, setAgentIdState] = useState(() => Number(readStored(AGENT_KEY)) || null);
  const [viewMode, setViewModeState] = useState(() => (readStored(VIEW_KEY) === 'tester' ? 'tester' : 'agent'));

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
    }),
    [agents, agentsError, agentsLoading, agentId, setAgentId, viewMode, setViewMode],
  );

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent() {
  const context = useContext(AgentContext);
  if (!context) throw new Error('useAgent must be used inside <AgentProvider>');
  return context;
}
