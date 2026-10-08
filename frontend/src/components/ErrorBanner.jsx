// Shows why something didn't go through, in the plain words the database sent back. Owner: Shanuja.
// A refusal because the branch is closed is explained as the business-hours rule working, not as a fault.
// This is the red error box. It shows the database's own message as it is and if the refusal is the business-hours rule, it explains that the branch is simply closed.
import { isBusinessHoursError } from '../api/client.js';

export default function ErrorBanner({ error, title = 'That did not go through' }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message;
  const closed = isBusinessHoursError(message);

  return (
    <div className="banner banner--error" role="alert">
      <p className="banner__title">{closed ? 'The branch is closed' : title}</p>
      <p>{message}</p>
      {closed && (
        <p className="banner__note">
          This is the business-hours rule working, not a fault. The opening hours are on the Home page.
        </p>
      )}
    </div>
  );
}
