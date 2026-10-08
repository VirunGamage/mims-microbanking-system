// An amount box with a fixed "LKR" in front. The value stays text, exactly as typed, so no floating-point
// rounding can creep in; pages check it with amountError() from utils/money.js.
// I built this so every amount field in the app looks and behaves the same way — a fixed LKR prefix and the value kept as plain text instead of a number.
// So typing or pasting an amount can never trigger silent floating-point rounding before it even reaches the server.

export default function MoneyInput({ value, onChange, ...inputProps }) {
  return (
    <div className="money-input">
      <span className="money-input__prefix" aria-hidden="true">
        LKR
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck="false"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...inputProps}
      />
    </div>
  );
}
