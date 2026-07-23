// One-time bootstrap for the very first platform_admins row — there is no
// public self-registration route for this table by design (see
// database/schema.sql's comment on platform_admins). Run manually, once, from the
// project root:
//   node scripts/createPlatformAdmin.js <email> <password> <name>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../backend/src/config/db');
const { isValidEmail } = require('../backend/src/validators/validators');

async function main() {
    const [email, password, ...nameParts] = process.argv.slice(2);
    const name = nameParts.join(' ');

    if (!email || !password || !name) {
        console.error('Usage: node scripts/createPlatformAdmin.js <email> <password> <name>');
        process.exit(1);
    }
    if (!isValidEmail(email)) {
        console.error('Not a valid email address.');
        process.exit(1);
    }
    if (password.length < 8) {
        console.error('Password must be at least 8 characters.');
        process.exit(1);
    }

    const cleanEmail = email.trim().toLowerCase();
    const [existing] = await db.query('SELECT id FROM platform_admins WHERE email = ?', [cleanEmail]);
    if (existing[0]) {
        console.error(`A platform admin with email ${cleanEmail} already exists.`);
        process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
        'INSERT INTO platform_admins (email, password_hash, name) VALUES (?, ?, ?)',
        [cleanEmail, hash, name.trim()]
    );

    console.log(`Platform admin created: id=${result.insertId}, email=${cleanEmail}`);
    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
