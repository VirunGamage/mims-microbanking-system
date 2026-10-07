// A field for choosing one savings account by its number (SA…), a holder's name or NIC, or its ID.
// Used by the Transactions and Fixed Deposits pages. Uses GET /api/accounts?search=.

//Lets the user search for and select a savings account using account or customer details.

import { useEffect, useRef, useState } from 'react';
import { searchAccounts } from '../../api/customers.js';
import { formatMoney } from '../../utils/money.js';

const SHOWN = 8;

export function holderNames(account) {
  return account.holders.map((holder) => holder.name).join(' & ');
}

export default function AccountPicker({ id, label = 'Account', hint, value, onChange, error }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const changeRef = useRef(null);
  const justPicked = useRef(false);

  useEffect(() => {
    if (value && justPicked.current) changeRef.current?.focus();
    justPicked.current = false;
  }, [value]);

  async function find() {
    setBusy(true);
    setProblem(null);
    try {
      setResults(await searchAccounts(text.trim()));
    } catch (err) {
      setProblem(err.message);
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  function pick(account) {
    justPicked.current = true;
    setResults(null);
    setText('');
    onChange(account);
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
            <p className="picked__name mono">{value.accountNo}</p>
            <p className="picked__meta">
              {value.planName} plan · {holderNames(value)}
            </p>
          </div>
          <button ref={changeRef} type="button" className="button button--quiet" onClick={() => onChange(null)}>
            Change<span className="visually-hidden"> account</span>
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
          placeholder="SA0000001, a holder's name or NIC"
          autoComplete="off"
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
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
              ? `No account matches "${text.trim()}".`
              : `${results.length} found${results.length > SHOWN ? `; showing the first ${SHOWN}` : ''}.`}
          </p>
          {results.length > 0 && (
            <ul className="pick-list">
              {results.slice(0, SHOWN).map((account) => (
                <li key={account.accountId}>
                  <button type="button" className="pick-list__item" onClick={() => pick(account)}>
                    <span className="pick-list__name mono">{account.accountNo}</span>
                    <span className="pick-list__meta">
                      {account.planName} · {holderNames(account)} · {formatMoney(account.balance)}
                      {account.status !== 'ACTIVE' ? ` · ${account.status.toLowerCase()}` : ''}
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
