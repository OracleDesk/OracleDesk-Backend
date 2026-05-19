import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { sendError } from '../utils/response.util';

export interface JwtPayload {
  userId: string;
  walletAddress: string;
  iat: number;
  exp: number;
}

// Extend Express Request to carry the decoded JWT
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Require a valid JWT Bearer token. Attaches decoded payload to req.user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    sendError(res, 401, 'UNAUTHORIZED', 'Missing or malformed Authorization header');
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      sendError(res, 401, 'TOKEN_EXPIRED', 'Token has expired');
    } else {
      sendError(res, 401, 'INVALID_TOKEN', 'Token is invalid');
    }
  }
}

/**
 * Generate a signed JWT for a user
 */
export function signToken(userId: string, walletAddress: string): string {
  return jwt.sign({ userId, walletAddress }, config.JWT_SECRET, { expiresIn: '7d' });
}