// A field for choosing one customer: type a name, NIC, phone or customer ID, then pick from the matches. Owner: Sameera.
// Used by the Open Account page for the primary and the second holder. Uses GET /api/customers?search=.
// A search and picker component to find customers by name, NIC, phone, or ID for account creation.
import { useEffect, useRef, useState } from 'react';
import { CUSTOMER_SEARCH_LIMIT, searchCustomers } from '../../api/customers.js';

const SHOWN = 8;

export default function CustomerPicker({ id, label, hint, value, onChange, error, excludeId = null }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState(null); // null until the first search
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const changeRef = useRef(null);
  const justPicked = useRef(false);

  // After a pick the search box disappears, so keyboard focus moves to the "Change" button instead of getting lost.
  useEffect(() => {
    if (value && justPicked.current) changeRef.current?.focus();
    justPicked.current = false;
  }, [value]);

  async function find() {
    setBusy(true);
    setProblem(null);
    try {
      const rows = await searchCustomers(text.trim());
      setResults(rows.filter((row) => row.customerId !== excludeId));
    } catch (err) {
      setProblem(err.message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  function pick(customer) {
    justPicked.current = true;
    setResults(null);
    setText('');
    onChange(customer);
  }

  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  if (value) {
    return (
      <div className="field" role="group" aria-labelledby={`${id}-label`}>
        <span id={`${id}-label`} className="field-label">
          {label}
        </span>
        <div className="picked">
          <div>
            <p className="picked__name">
              {value.firstName} {value.lastName}
            </p>
            <p className="picked__meta">
              Customer {value.customerId} · age {value.age} · NIC {value.nic ?? 'not recorded'}
            </p>
          </div>
          <button ref={changeRef} type="button" className="button button--quiet" onClick={() => onChange(null)}>
            Change<span className="visually-hidden"> {label.toLowerCase()}</span>
          </button>
        </div>
        {error && (
          <p id={errorId} className="field-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      <div className="search-row">
        <input
          id={id}
          type="search"
          value={text}
          placeholder="Name, NIC, phone or ID"
          autoComplete="off"
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault(); // Enter here means "find", not "submit the whole form"
              find();
            }
          }}
        />
        <button type="button" className="button button--quiet" onClick={find} disabled={busy}>
          {busy ? 'Finding…' : 'Find'}
        </button>
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      {problem && <p className="field-error">{problem}</p>}
      {results && (
        <div className="pick-results">
          <p className="field-hint" role="status">
            {results.length === 0
              ? `No customer matches "${text.trim()}".`
              : `${results.length}${results.length >= CUSTOMER_SEARCH_LIMIT ? '+' : ''} found${results.length > SHOWN ? `; showing the first ${SHOWN}, type more to narrow it down` : ''}.`}
          </p>
          {results.length > 0 && (
            <ul className="pick-list">
              {results.slice(0, SHOWN).map((customer) => (
                <li key={customer.customerId}>
                  <button type="button" className="pick-list__item" onClick={() => pick(customer)}>
                    <span className="pick-list__name">
                      {customer.firstName} {customer.lastName}
                    </span>
                    <span className="pick-list__meta">
                      ID {customer.customerId} · age {customer.age} · {customer.nic ?? 'no NIC'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
