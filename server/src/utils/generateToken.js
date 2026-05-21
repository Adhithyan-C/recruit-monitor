import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function generateToken({ userId, email, role, name }) {
  return jwt.sign(
    { userId, email, role, name },
    config.jwtSecret,
    { expiresIn: '12h' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
