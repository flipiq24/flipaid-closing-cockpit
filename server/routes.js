// Auth + portfolio + property REST API. All /api/groups and /api/properties routes
// require a logged-in session; everything is scoped to the session user.
import express from 'express';
import { pool, hashPassword, verifyPassword, seedPortfolio } from './db.js';

// Map the cockpit's IA "mode" (Estimated / Acquired / Sold) onto the property status column.
function statusFromMode(mode) {
  return ['Estimated', 'Acquired', 'Sold'].includes(mode) ? mode : 'Estimated';
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not signed in' });
}

export function buildRouter() {
  const r = express.Router();

  /* ---------------- AUTH ---------------- */
  r.post('/api/signup', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    try {
      const exists = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);
      if (exists.rows.length) return res.status(409).json({ error: 'An account with that email already exists.' });
      const u = await pool.query(
        `INSERT INTO users(email, password_hash) VALUES($1, $2) RETURNING id, email`,
        [email, hashPassword(password)]
      );
      const user = u.rows[0];
      await seedPortfolio(user.id);
      req.session.userId = user.id;
      req.session.email = user.email;
      res.json({ id: user.id, email: user.email });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  r.post('/api/login', async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    try {
      const u = await pool.query(`SELECT id, email, password_hash FROM users WHERE email=$1`, [email]);
      if (!u.rows.length || !verifyPassword(password, u.rows[0].password_hash)) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
      }
      req.session.userId = u.rows[0].id;
      req.session.email = u.rows[0].email;
      res.json({ id: u.rows[0].id, email: u.rows[0].email });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  r.post('/api/logout', (req, res) => {
    if (req.session) req.session.destroy(() => res.json({ ok: true }));
    else res.json({ ok: true });
  });

  r.get('/api/me', (req, res) => {
    if (req.session && req.session.userId) return res.json({ id: req.session.userId, email: req.session.email });
    res.status(401).json({ error: 'Not signed in' });
  });

  /* ---------------- PORTFOLIO (groups + their properties) ---------------- */
  r.get('/api/portfolio', requireAuth, async (req, res) => {
    const uid = req.session.userId;
    try {
      const groups = (await pool.query(
        `SELECT id, name, created_at FROM groups WHERE user_id=$1 ORDER BY created_at, id`, [uid]
      )).rows;
      const props = (await pool.query(
        `SELECT id, group_id, address, status, created_at, last_opened_at
           FROM properties WHERE user_id=$1 ORDER BY created_at, id`, [uid]
      )).rows;
      const byGroup = g => props.filter(p => p.group_id === g);
      res.json({
        email: req.session.email,
        groups: groups.map(g => ({ ...g, properties: byGroup(g.id) })),
        ungrouped: props.filter(p => p.group_id == null)
      });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  /* ---------------- GROUPS ---------------- */
  r.post('/api/groups', requireAuth, async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Group name is required.' });
    try {
      const g = await pool.query(
        `INSERT INTO groups(user_id, name) VALUES($1, $2) RETURNING id, name, created_at`,
        [req.session.userId, name]
      );
      res.json(g.rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.patch('/api/groups/:id', requireAuth, async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Group name is required.' });
    try {
      const g = await pool.query(
        `UPDATE groups SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING id, name`,
        [name, req.params.id, req.session.userId]
      );
      if (!g.rows.length) return res.status(404).json({ error: 'Group not found.' });
      res.json(g.rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Deleting a group does NOT delete its properties — they become ungrouped (FK ON DELETE SET NULL).
  r.delete('/api/groups/:id', requireAuth, async (req, res) => {
    try {
      const g = await pool.query(`DELETE FROM groups WHERE id=$1 AND user_id=$2 RETURNING id`,
        [req.params.id, req.session.userId]);
      if (!g.rows.length) return res.status(404).json({ error: 'Group not found.' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  /* ---------------- PROPERTIES ---------------- */
  r.post('/api/properties', requireAuth, async (req, res) => {
    const address = String((req.body && req.body.address) || '').trim();
    const groupId = (req.body && req.body.groupId) || null;
    if (!address) return res.status(400).json({ error: 'Property address is required.' });
    try {
      if (groupId != null) {
        const og = await pool.query(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [groupId, req.session.userId]);
        if (!og.rows.length) return res.status(400).json({ error: 'Group not found.' });
      }
      const p = await pool.query(
        `INSERT INTO properties(user_id, group_id, address, status, data)
         VALUES($1, $2, $3, 'Estimated', '{}'::jsonb)
         RETURNING id, group_id, address, status, created_at, last_opened_at`,
        [req.session.userId, groupId, address]
      );
      res.json(p.rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Reading a single property = opening it: bump last_opened_at and return its data blob.
  r.get('/api/properties/:id', requireAuth, async (req, res) => {
    try {
      const p = await pool.query(
        `UPDATE properties SET last_opened_at=now()
           WHERE id=$1 AND user_id=$2
           RETURNING id, group_id, address, status, data, created_at, last_opened_at`,
        [req.params.id, req.session.userId]
      );
      if (!p.rows.length) return res.status(404).json({ error: 'Property not found.' });
      res.json(p.rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  // Partial update: any of address / status / groupId / data. Used by the cockpit to persist edits.
  r.patch('/api/properties/:id', requireAuth, async (req, res) => {
    const b = req.body || {};
    const sets = [];
    const vals = [];
    let n = 1;
    if (typeof b.address === 'string') { sets.push(`address=$${n++}`); vals.push(b.address.trim()); }
    if (typeof b.status === 'string') { sets.push(`status=$${n++}`); vals.push(statusFromMode(b.status)); }
    if (typeof b.mode === 'string') { sets.push(`status=$${n++}`); vals.push(statusFromMode(b.mode)); }
    if (b.data !== undefined) { sets.push(`data=$${n++}`); vals.push(JSON.stringify(b.data)); }
    if ('groupId' in b) {
      if (b.groupId != null) {
        const og = await pool.query(`SELECT id FROM groups WHERE id=$1 AND user_id=$2`, [b.groupId, req.session.userId]);
        if (!og.rows.length) return res.status(400).json({ error: 'Group not found.' });
      }
      sets.push(`group_id=$${n++}`); vals.push(b.groupId);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    vals.push(req.params.id, req.session.userId);
    try {
      const p = await pool.query(
        `UPDATE properties SET ${sets.join(', ')} WHERE id=$${n++} AND user_id=$${n}
         RETURNING id, group_id, address, status, created_at, last_opened_at`,
        vals
      );
      if (!p.rows.length) return res.status(404).json({ error: 'Property not found.' });
      res.json(p.rows[0]);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  r.delete('/api/properties/:id', requireAuth, async (req, res) => {
    try {
      const p = await pool.query(`DELETE FROM properties WHERE id=$1 AND user_id=$2 RETURNING id`,
        [req.params.id, req.session.userId]);
      if (!p.rows.length) return res.status(404).json({ error: 'Property not found.' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  return r;
}
