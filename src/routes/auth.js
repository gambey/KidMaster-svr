const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

const tokenFromUser = (user) =>
  jwt.sign(
    { id: user.id, phoneNumber: user.phoneNumber },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '7d' }
  );

router.post('/login', async (req, res) => {
  const { phoneNumber, password, name } = req.body || {};
  if (!phoneNumber || !password) {
    return res.status(400).json({ message: 'phoneNumber and password are required' });
  }
  try {
    const [rows] = await db.execute(
      'SELECT id, phoneNumber, password_hash FROM users WHERE phoneNumber = ? LIMIT 1',
      [phoneNumber]
    );

    // If user does not exist, create and treat as "register + login"
    if (!rows.length) {
      const hashed = await bcrypt.hash(password, 10);
      const [result] = await db.execute(
        'INSERT INTO users (phoneNumber, password_hash, name) VALUES (?, ?, ?)',
        [phoneNumber, hashed, name || null]
      );
      const token = tokenFromUser({ id: result.insertId, phoneNumber });
      return res.status(201).json({ token, created: true });
    }

    // Otherwise, verify password and treat as login
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = tokenFromUser(user);
    return res.json({ token, created: false });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

