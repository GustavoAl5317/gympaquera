/** @param {object} db sqlite database with prepare().get() */
function isPremiumActive(db, userId) {
    const id = parseInt(userId, 10);
    if (!id) return false;
    const row = db.prepare('SELECT premium_until FROM users WHERE id = ?').get(id);
    if (!row || !row.premium_until) return false;
    const d = new Date(row.premium_until);
    return !Number.isNaN(d.getTime()) && d > new Date();
}

module.exports = { isPremiumActive };
