// In-memory pub/sub for live-queue SSE connections. Keyed per
// hospital+doctor+shift so a broadcast only reaches admins actually watching
// that specific queue, not every connected dashboard.
const subscribers = new Map();

function key(hospitalId, doctorId, shift) {
    return `${hospitalId}_${doctorId}_${shift}`;
}

function subscribe(hospitalId, doctorId, shift, res) {
    const k = key(hospitalId, doctorId, shift);
    if (!subscribers.has(k)) subscribers.set(k, new Set());
    subscribers.get(k).add(res);

    return () => {
        const set = subscribers.get(k);
        if (!set) return;
        set.delete(res);
        if (set.size === 0) subscribers.delete(k);
    };
}

function broadcast(hospitalId, doctorId, shift, data) {
    const set = subscribers.get(key(hospitalId, doctorId, shift));
    if (!set || set.size === 0) return;

    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
        try { res.write(payload); } catch (e) { /* client gone; cleaned up via the connection's own 'close' handler */ }
    }
}

module.exports = { subscribe, broadcast };
