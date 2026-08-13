const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'credentials', 'gmail-config.json');

function createClient() {
    const { email, appPassword } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: email, pass: appPassword },
        logger: false,
    });
}

async function getLatestUid() {
    const client = createClient();
    await client.connect();
    let uid = 0;
    try {
        const mailbox = await client.mailboxOpen('INBOX');
        uid = mailbox.uidNext - 1;
        console.log(`Current latest UID in inbox: ${uid}`);
    } finally {
        await client.logout();
    }
    return uid;
}

async function fetchLatestOtp(sinceUid = 0, subject = 'One time password', waitTimeoutMs = 60000, pollIntervalMs = 5000) {
    let otp = null;
    const deadline = Date.now() + waitTimeoutMs;

    while (Date.now() < deadline) {
        // Open a fresh IMAP connection each poll so Gmail shows newly arrived messages
        const client = createClient();
        try {
            await client.connect();
            await client.mailboxOpen('INBOX');

            // Search by UID range to find new messages since snapshot
            // Filter strictly > sinceUid: Gmail may return sinceUid itself when no new mail exists
            const allUids = await client.search({ uid: `${sinceUid + 1}:*` }, { uid: true });
            const uids = allUids.filter(uid => uid > sinceUid);

            if (uids.length > 0) {
                // Sort descending to try newest first
                uids.sort((a, b) => b - a);

                for (const uid of uids) {
                    for await (const msg of client.fetch(`${uid}`, { envelope: true, source: true }, { uid: true })) {
                        const msgSubject = (msg.envelope && msg.envelope.subject) || '';
                        if (msgSubject.toLowerCase().includes(subject.toLowerCase())) {
                            const raw = msg.source.toString('utf-8');
                            otp = extractOtp(raw);
                            if (otp) {
                                console.log(`OTP extracted from email (UID ${uid}, subject: "${msgSubject}"): ${otp}`);
                            }
                        } else {
                            console.log(`  Skipping UID ${uid} — subject: "${msgSubject}"`);
                        }
                    }
                    if (otp) break;
                }
            }
        } finally {
            await client.logout().catch(() => {});
        }

        if (otp) break;

        console.log(`No OTP email found yet (subject: "${subject}"), retrying in ${pollIntervalMs / 1000}s...`);
        await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!otp) throw new Error(`OTP not received within ${waitTimeoutMs / 1000}s (subject: "${subject}")`);
    return otp;
}

function extractOtp(rawEmail) {
    // Strip email headers — body starts after the first blank line
    const bodyStart = rawEmail.indexOf('\r\n\r\n');
    const body = bodyStart !== -1 ? rawEmail.slice(bodyStart + 4) : rawEmail;

    // Remove <head> (contains CSS with hex color codes like #355497 that look like OTPs)
    const noHead = body.replace(/<head[\s\S]*?<\/head>/gi, '');

    // Remove remaining HTML tags, then find first standalone 4-8 digit number (the OTP)
    const text = noHead.replace(/<[^>]+>/g, ' ');
    const match = text.match(/\b(\d{4,8})\b/);
    return match ? match[1] : null;
}

module.exports = { getLatestUid, fetchLatestOtp };
