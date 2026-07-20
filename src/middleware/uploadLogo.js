const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Stored under admin/public so express.static (already mounted at /admin in
// app.js) serves it directly — no new static route needed. Filename is a
// random token, not the hospital's id, since the hospital row doesn't exist
// yet at upload time (registration is one multipart request: file + fields
// together, hospital created only after the whole payload validates).
const UPLOAD_DIR = path.join(__dirname, '..', 'admin', 'public', 'uploads', 'logos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
        const token = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${token}${ext}`);
    }
});

function fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error('Logo must be a PNG, JPEG, WEBP, or SVG image'));
    }
    cb(null, true);
}

// Single optional "logo" field, 2MB cap. multer only touches this one field —
// every other registration field arrives as a normal multipart text part and
// lands in req.body exactly like express.json() would for a JSON request.
const singleLogoUpload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 }
}).single('logo');

// Wrapped so a bad upload (oversized file, wrong type) reaches the client as
// a clean 400 with the real reason, instead of falling through to app.js's
// generic 500 handler (multer/fileFilter errors are passed to next(err) like
// any Express middleware error, they just aren't a case that handler
// special-cases — every other validation error in this codebase returns a
// specific 400, so this matches that convention rather than being the one
// exception).
module.exports = function uploadLogo(req, res, next) {
    singleLogoUpload(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Logo image must be 2MB or smaller' });
        }
        return res.status(400).json({ error: err.message || 'Could not process the uploaded logo' });
    });
};
