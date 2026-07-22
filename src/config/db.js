require('dotenv').config();

// Supabase/Postgres migration: the app was originally written entirely
// against mysql2's API shape — `db.query(sql, params)` destructured as
// `const [rows] = ...` (SELECT) or `const [result] = ...` with
// `result.insertId`/`result.affectedRows` (INSERT/UPDATE/DELETE), plus
// `db.getConnection()` returning a connection with beginTransaction/commit/
// rollback/release for the one transactional call site (bookingService's
// token-allocation lock). Rather than rewriting every one of the ~300 query
// call sites across 36 files to pg's native `$1,$2` placeholders and
// `{rows, rowCount}` result shape, this module translates at the boundary so
// existing query strings and destructuring patterns keep working unchanged.
// Falls back to the original mysql2 pool when DATABASE_URL isn't set, so
// removing DATABASE_URL from .env is a complete, working rollback to local
// MySQL with no code changes needed anywhere else.
if (process.env.DATABASE_URL) {
    const { Pool, types } = require('pg');

    // pg returns BIGINT (OID 20) — what COUNT(*)/SUM(int_col) produce — as a
    // string by default, to avoid silently losing precision above
    // Number.MAX_SAFE_INTEGER. Every count/sum in this app (appointment
    // counts, doctor counts, pagination totals, etc.) is nowhere near that
    // range, and the app's existing code (strict-equality checks like
    // `result.count === 1` for pluralizing "department"/"departments",
    // pagination math) was written against mysql2's plain-number counts —
    // so this is overridden globally here rather than hunting down every
    // COUNT(*) call site to add a `::int` cast or `Number(...)` wrapper.
    types.setTypeParser(20, (val) => parseInt(val, 10));

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10
    });

    // `?` -> `$1, $2, ...`, skipping `?` characters inside single-quoted
    // string literals (none of this app's queries actually have one, but
    // cheap to guard against). `''` is the only escape form used anywhere in
    // this codebase's raw SQL (no queries build literal strings containing
    // a backslash-escaped quote), so that's the only case handled here.
    function translatePlaceholders(sql) {
        let out = '';
        let inString = false;
        let paramIndex = 0;
        for (let i = 0; i < sql.length; i++) {
            const ch = sql[i];
            if (ch === "'") {
                if (inString && sql[i + 1] === "'") { out += "''"; i++; continue; }
                inString = !inString;
                out += ch;
                continue;
            }
            if (ch === '?' && !inString) {
                paramIndex++;
                out += '$' + paramIndex;
                continue;
            }
            out += ch;
        }
        return out;
    }

    // Every table in this schema uses `id` as its serial PK except
    // user_sessions (keyed by phone_number, no id column at all) — see
    // db/schema.sql. mysql2's `result.insertId` has no native pg equivalent
    // without an explicit RETURNING clause, so one is injected automatically
    // rather than touching every INSERT call site individually.
    const NO_ID_TABLES = new Set(['user_sessions']);
    function withReturningId(sql) {
        if (/\bRETURNING\b/i.test(sql)) return sql;
        const match = sql.match(/^\s*INSERT\s+INTO\s+`?(\w+)`?/i);
        if (!match) return sql;
        if (NO_ID_TABLES.has(match[1])) return sql;
        return sql.replace(/;?\s*$/, ' RETURNING id');
    }

    function isSelectLike(sql) {
        return /^\s*(SELECT|SHOW|DESCRIBE|WITH)\b/i.test(sql);
    }

    // App code in 5 files (bookingService's token-allocation retry loop,
    // billingAdminService, staffAdminService, hospitalRegistrationService,
    // platformAdminService) checks `err.code === 'ER_DUP_ENTRY'` /
    // 'ER_LOCK_DEADLOCK' (mysql2's error codes) to decide whether to retry or
    // return a friendly "already exists" error. Postgres's equivalents are
    // '23505' (unique_violation) / '40P01' (deadlock_detected) — remapped
    // here so every existing check keeps working unchanged.
    const PG_ERROR_CODE_MAP = { '23505': 'ER_DUP_ENTRY', '40P01': 'ER_LOCK_DEADLOCK' };

    // Shapes a pg QueryResult into mysql2's [rows]/[ResultSetHeader] tuple so
    // every existing `const [rows] = await db.query(...)` and
    // `const [[row]] = await db.query(...)` call site keeps working, and so
    // does every `result.insertId`/`result.affectedRows` read.
    async function runQuery(executor, sql, params = []) {
        const pgSql = withReturningId(translatePlaceholders(sql));
        let result;
        try {
            result = await executor(pgSql, params);
        } catch (err) {
            if (PG_ERROR_CODE_MAP[err.code]) err.code = PG_ERROR_CODE_MAP[err.code];
            throw err;
        }
        if (isSelectLike(sql)) {
            return [result.rows, result.fields];
        }
        const header = {
            affectedRows: result.rowCount,
            insertId: (result.rows && result.rows[0] && result.rows[0].id) || undefined
        };
        return [header, undefined];
    }

    module.exports = {
        query: (sql, params) => runQuery((s, p) => pool.query(s, p), sql, params),
        async getConnection() {
            const client = await pool.connect();
            return {
                query: (sql, params) => runQuery((s, p) => client.query(s, p), sql, params),
                beginTransaction: () => client.query('BEGIN'),
                commit: () => client.query('COMMIT'),
                rollback: () => client.query('ROLLBACK'),
                release: () => client.release()
            };
        }
    };
} else {
    const mysql = require('mysql2/promise');

    module.exports = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}
