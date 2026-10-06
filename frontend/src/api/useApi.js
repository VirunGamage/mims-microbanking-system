// Two small React hooks on top of the API client. Owner: Virun.
// useApiData loads data when a page opens (with loading and error states); useAction runs a form submit and
// remembers whether it is busy, what it returned and what went wrong.
// Two React hooks: useApiData loads data when a page opens with loading and error states, and useAction runs a form submit and remembers whether it is busy, what came back and what went wrong.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client.js';

// The branch light and the "branch is closed" notes ask again this often, so a page left open notices the change.
export const STATUS_REFRESH_MS = 60_000;

export function useApiData(path, { enabled = true, record = false, refreshMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path && enabled) });
  const [version, setVersion] = useState(0);

  // refreshMs > 0: load again every refreshMs milliseconds (the old data stays on screen meanwhile).
  useEffect(() => {
    if (!refreshMs || !path || !enabled) return undefined;
    const timer = setInterval(() => setVersion((v) => v + 1), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, path, enabled]);

  useEffect(() => {
    if (!path || !enabled) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    let cancelled = false; // ignore an answer that arrives after the page has moved on
    setState((previous) => ({ ...previous, loading: true, error: null }));
    api
      .get(path, { record })
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [path, enabled, record, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

// Whether the branch is open now (GET /api/status), asked again every minute.
export function useBranchStatus() {
  return useApiData('/status', { refreshMs: STATUS_REFRESH_MS });
}

export function useAction(action) {
  const [state, setState] = useState({ busy: false, error: null, result: null });
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(async (...args) => {
    setState({ busy: true, error: null, result: null });
    try {
      const result = await actionRef.current(...args);
      setState({ busy: false, error: null, result });
      return result;
    } catch (error) {
      setState({ busy: false, error, result: null });
      return undefined;
    }
  }, []);

  const reset = useCallback(() => setState({ busy: false, error: null, result: null }), []);
  return { ...state, run, reset };
}
