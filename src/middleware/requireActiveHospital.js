const db = require('../config/db');

// Applied after jwtAuth on routes that must stop working immediately once a
// hospital is suspended, not just once its already-issued JWTs (up to 8h
// lifetime) eventually expire — re-checks the live DB status on every
// request rather than trusting a claim baked into the token at login time.
module.exports = async function requireActiveHospital(req, res, next) {
    const [[hospital]] = await db.query('SELECT status FROM hospitals WHERE id = ?', [req.admin.hospital_id]);
    if (hospital && hospital.status === 'Suspended') {
        return res.status(403).json({ error: 'This hospital account has been suspended. Please contact support.' });
    }
    next();
};
