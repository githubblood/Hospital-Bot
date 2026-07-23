// Shared avatar helpers: initials + a name-hashed color class, so the same
// person renders with the same color everywhere without storing a color.
const Avatar = {
    initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    },
    colorClass(name) {
        const str = String(name || '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        return `avatar-c${hash % 6}`;
    },
    // Returns an HTML string for a ready-to-insert avatar circle.
    html(name, sizeClass = '') {
        return `<div class="avatar-circle ${this.colorClass(name)} ${sizeClass}">${this.initials(name)}</div>`;
    }
};
