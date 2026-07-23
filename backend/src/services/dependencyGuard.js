// Reusable "block this archive/delete if active dependents still reference
// it" check — the same shape doctorAdminService.deleteDoctor already used
// for its own appointment-count guard, now formalized so Departments,
// Branches, and any future archive/delete flow share one result contract
// instead of each hand-rolling its own. Deliberately does NOT build the SQL
// itself (that would mean string-interpolating table/column names into a
// query, which this codebase never does) — callers run their own
// parameterized COUNT query and hand the result in here.
function blockIfInUse(count) {
    return count > 0 ? { error: 'IN_USE', count } : null;
}

module.exports = { blockIfInUse };
