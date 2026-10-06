// Tester view only: a fold-out panel showing the last action's request, the procedure the server called with its
// parameters and OUT values, and the answer. It never shows secrets or raw SQL errors.
// This only shows up in Tester view. It helps verify the frontend is calling the right stored procedure with the right values during testing.
import { useEffect, useState } from 'react';
import { getLastExchange, onExchange } from '../api/client.js';
import { useAgent } from '../context/AgentContext.jsx';

function Json({ value }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

export default function RequestPanel() {
  const { isTester } = useAgent();
  const [exchange, setExchange] = useState(getLastExchange);

  useEffect(() => onExchange(setExchange), []);

  if (!isTester) return null;
  return (
    <details className="request-panel">
      <summary>What was sent / what the database returned</summary>
      <div className="request-panel__body" aria-live="polite">
        {!exchange ? (
          <p>Nothing sent yet. Submit a form and its request and answer appear here.</p>
        ) : (
          <dl>
            <dt>Request</dt>
            <dd className="mono">
              {exchange.sent.method} {exchange.sent.path}
            </dd>
            {exchange.sent.body && (
              <>
                <dt>Sent</dt>
                <dd>
                  <Json value={exchange.sent.body} />
                </dd>
              </>
            )}
            {exchange.debug?.procedure && (
              <>
                <dt>Database call</dt>
                <dd className="mono">{exchange.debug.procedure}</dd>
                <dt>Parameters</dt>
                <dd>
                  <Json value={exchange.debug.params} />
                </dd>
              </>
            )}
            {exchange.debug?.out && (
              <>
                <dt>OUT values</dt>
                <dd>
                  <Json value={exchange.debug.out} />
                </dd>
              </>
            )}
            <dt>Answer</dt>
            <dd>
              {exchange.status === 0 ? 'No answer' : `HTTP ${exchange.status}`}
              {exchange.error ? ` — ${exchange.error}` : ' — OK'}
            </dd>
            {exchange.data !== undefined && (
              <>
                <dt>Data</dt>
                <dd>
                  <Json value={exchange.data} />
                </dd>
              </>
            )}
          </dl>
        )}
      </div>
    </details>
  );
}
