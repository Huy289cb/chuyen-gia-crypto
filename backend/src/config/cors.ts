import cors from 'cors';
import type { CorsOptions } from 'cors';
import type { Request, Response, NextFunction } from 'express';

/**
 * Production-ready CORS configuration
 * Whitelist-based approach with environment variable support
 */

// Parse allowed origins from environment variable
const getAllowedOrigins = (): string[] => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  
  if (!allowedOrigins) {
    // Default origins for development
    return [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:5173',
      'http://localhost:8080'
    ];
  }
  
  // Split comma-separated origins and trim whitespace
  return allowedOrigins
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
};

// CORS options object
const corsOptions: CorsOptions = {
  // Dynamic origin checking
  origin: (origin, callback) => {
    // Allow requests with no origin (Postman, curl, mobile apps, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    const allowedOrigins = getAllowedOrigins();
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Origin ${origin} not allowed`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  
  // Enable credentials (cookies, authorization headers, etc.)
  credentials: true,
  
  // Allowed methods for preflight requests
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  
  // Allowed headers
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control'
  ],
  
  // Expose these headers to the client
  exposedHeaders: ['X-Total-Count'],
  
  // Cache preflight requests for 24 hours
  maxAge: 86400,
  
  // Handle preflight requests properly
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Create and export the CORS middleware
const allowlistedCorsMiddleware = cors(corsOptions);

/** The backend-served paper page may POST to its own origin without changing other API origins. */
export function isPaperSameOrigin(req: Pick<Request, 'path' | 'protocol' | 'get'>): boolean {
  if (req.path !== '/api/portfolio-paper' && !req.path.startsWith('/api/portfolio-paper/')) return false;
  const origin = req.get('origin');
  const host = req.get('host');
  if (!origin || !host || !['http', 'https'].includes(req.protocol)) return false;
  return origin === `${req.protocol}://${host}`;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isPaperSameOrigin(req)) { next(); return; }
  allowlistedCorsMiddleware(req, res, next);
}

// Export helper function for testing
export const isOriginAllowed = (origin: string | undefined): boolean => {
  if (!origin) return true;
  return getAllowedOrigins().includes(origin);
};
