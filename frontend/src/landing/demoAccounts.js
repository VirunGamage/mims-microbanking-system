// The demo sign-ins from sample-data/05_app_logins.sql, shown on the start page so examiners and the team can try every
// kind of login. They only exist in the sample data; every demo password is the same.
export const DEMO_PASSWORD = 'demo1234';

export const DEMO_ACCOUNTS = {
  CUSTOMER: [
    { username: 'james', who: 'James Anderson', note: 'Adult account with an active fixed deposit' },
    { username: 'sophia', who: 'Sophia Thomas', note: 'Adult account, no fixed deposit yet: try opening one' },
    { username: 'lucas', who: 'Lucas Thompson', note: 'Primary holder of a joint account' },
    { username: 'harper', who: 'Harper Garcia', note: 'Second holder of the same joint account' },
  ],
  AGENT: [
    { username: 'alice', who: 'Alice Smith', note: 'Agent at Central Branch' },
    { username: 'carol', who: 'Carol Lee', note: 'Agent at North Branch' },
  ],
  ADMIN: [{ username: 'admin', who: 'Bank administrator', note: 'Every screen, plus the Tester view' }],
};
