/**
 * Fetches a 6-digit OTP from Gmail via IMAP.
 *
 * Prerequisites:
 *  1. Enable IMAP in Gmail → Settings → See all settings → Forwarding and POP/IMAP
 *  2. Create an App Password at https://myaccount.google.com/apppasswords
 *     (requires 2-Step Verification to be on)
 *  3. Add to .env:
 *       GMAIL_USER=you@gmail.com
 *       GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 *       OTP_EMAIL_FROM=          # optional: filter by sender address
 *       OTP_EMAIL_SUBJECT=OTP    # optional: filter by subject keyword
 */

const Imap         = require('imap');
const { simpleParser } = require('mailparser');

/**
 * Polls Gmail INBOX until a recent unread email containing a 6-digit OTP
 * arrives, then returns the OTP string.
 *
 * @param {object}  opts
 * @param {string}  opts.user            Gmail address
 * @param {string}  opts.password        App Password (spaces are ignored)
 * @param {string}  [opts.fromFilter]    Sender filter (partial match)
 * @param {string}  [opts.subjFilter]    Subject filter (partial match)
 * @param {string}  [opts.userIdFilter]  If set, email body must contain this string (e.g. "TEMPMF11")
 * @param {number}  [opts.timeout]       Max wait in ms (default 120 000)
 * @param {number}  [opts.pollMs]        Poll interval in ms (default 5 000)
 * @returns {Promise<string>}            6-digit OTP
 */
function fetchOtpFromGmail({
  user,
  password,
  fromFilter   = process.env.OTP_EMAIL_FROM    || '',
  subjFilter   = process.env.OTP_EMAIL_SUBJECT || '',
  userIdFilter = process.env.OTP_USER_ID       || '',
  timeout      = 120000,
  pollMs       = 5000,
} = {}) {
  if (!user || !password) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env');
  }

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user,
      password: password.replace(/\s/g, ''),   // strip spaces from App Password
      host:     'imap.gmail.com',
      port:     993,
      tls:      true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    });

    const deadline = Date.now() + timeout;
    let resolved   = false;

    function done(err, otp) {
      if (resolved) return;
      resolved = true;
      try { imap.end(); } catch {}
      if (err) reject(err); else resolve(otp);
    }

    function tryFetch() {
      if (Date.now() >= deadline) {
        return done(new Error(`OTP email not received within ${timeout / 1000}s`));
      }

      imap.openBox('INBOX', false, (err) => {
        if (err) return done(err);

        // Search unread emails in the last 3 minutes — avoids picking up
        // stale/already-used OTPs from earlier test runs.
        const since = new Date(Date.now() - 3 * 60 * 1000);
        const criteria = ['UNSEEN', ['SINCE', since]];
        if (fromFilter)   criteria.push(['FROM',    fromFilter]);
        if (subjFilter)   criteria.push(['SUBJECT', subjFilter]);
        if (userIdFilter) criteria.push(['TO',      userIdFilter]);

        imap.search(criteria, (err, uids) => {
          if (err) return done(err);

          if (!uids || uids.length === 0) {
            // No matching email yet — wait and retry
            setTimeout(tryFetch, pollMs);
            return;
          }

          // Process the most recent match
          const uid = uids[uids.length - 1];
          const f   = imap.fetch(uid, { bodies: '' });

          f.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return done(err);

                const body = [parsed.text, parsed.html]
                  .filter(Boolean)
                  .join(' ');

                // If a user ID filter is set, skip emails not addressed to that user
                if (!body.includes(userIdFilter)) {
                  console.log(`    [emailOtp] Skipping email — body does not contain "${userIdFilter}"`);
                  setTimeout(tryFetch, pollMs);
                  return;
                }

                // Extract first 6-digit sequence that looks like an OTP
                const match = body.match(/\b(\d{6})\b/);
                if (match) {
                  // Mark the email as seen so re-runs don't reuse this OTP
                  try { imap.addFlags(uid, '\\Seen', () => {}); } catch {}
                  done(null, match[1]);
                } else {
                  // Email arrived but no 6-digit code found; retry
                  setTimeout(tryFetch, pollMs);
                }
              });
            });
          });

          f.once('error', done);
        });
      });
    }

    imap.once('ready', tryFetch);
    imap.once('error', done);
    imap.connect();
  });
}

/**
 * Marks all unread OTP emails as SEEN before a new login flow starts.
 * Prevents stale OTPs from a prior (failed/interrupted) run being picked up
 * as the first OTP of the new session.
 */
function purgeStaleOtps({
  user,
  password,
  fromFilter = process.env.OTP_EMAIL_FROM    || '',
  subjFilter = process.env.OTP_EMAIL_SUBJECT || '',
} = {}) {
  if (!user || !password) return Promise.resolve();

  return new Promise((resolve) => {
    const imap = new Imap({
      user,
      password: password.replace(/\s/g, ''),
      host:     'imap.gmail.com',
      port:     993,
      tls:      true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 10000,
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { try { imap.end(); } catch {} return resolve(); }

        const criteria = ['UNSEEN'];
        if (fromFilter) criteria.push(['FROM',    fromFilter]);
        if (subjFilter) criteria.push(['SUBJECT', subjFilter]);

        imap.search(criteria, (err, uids) => {
          if (err || !uids || uids.length === 0) {
            try { imap.end(); } catch {}
            return resolve();
          }
          imap.addFlags(uids, '\\Seen', () => {
            console.log(`    [emailOtp] Purged ${uids.length} stale OTP email(s)`);
            try { imap.end(); } catch {}
            resolve();
          });
        });
      });
    });

    imap.once('error', () => { try { imap.end(); } catch {} resolve(); });
    imap.connect();
  });
}

module.exports = { fetchOtpFromGmail, purgeStaleOtps };
