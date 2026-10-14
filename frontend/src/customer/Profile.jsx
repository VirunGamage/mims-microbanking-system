// The customer's own details as the bank holds them, and who else holds their joint accounts. Changes are made at the
// branch, where an agent checks the documents.
import PageHeader from '../components/PageHeader.jsx';
import { maskNic } from '../utils/customerRules.js';
import { formatDate } from '../utils/format.js';
import { useBanking } from './CustomerApp.jsx';

export default function Profile() {
  const { profile, accounts } = useBanking();
  const details = [
    ['Name', `${profile.firstName} ${profile.lastName}`],
    ['NIC', maskNic(profile.nic)],
    ['Date of birth', formatDate(profile.dob)],
    ['Phone', profile.phone || '—'],
    ['E-mail', profile.email || '—'],
    ['Address', profile.address || '—'],
    ['Home branch', profile.branchName],
  ];

  return (
    <>
      <PageHeader title="Profile" intro="Your details as the bank holds them." />
      <div className="portal-columns">
        <section className="panel" aria-labelledby="details-heading">
          <h2 id="details-heading">Personal details</h2>
          <dl className="summary-list">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="field-hint">To change your details, visit your branch with your NIC.</p>
        </section>
        <section className="panel" aria-labelledby="held-heading">
          <h2 id="held-heading">Accounts you hold</h2>
          <ul className="portal-points">
            {accounts.map((account) => (
              <li key={account.accountId}>
                <span className="mono">{account.accountNo}</span>, {account.planName} savings, opened {formatDate(account.openDate)}.{' '}
                You are the {account.role === 'PRIMARY' ? 'primary' : 'second'} holder
                {account.otherHolders ? `; also held by ${account.otherHolders}.` : '.'}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
