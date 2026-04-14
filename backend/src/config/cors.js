import cors from 'cors';

/**
 * Production-ready CORS configuration
 * Whitelist-based approach with environment variable support
 */

// Parse allowed origins from environment variable
const getAllowedOrigins = () => {
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
const corsOptions = {
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
export const corsMiddleware = cors(corsOptions);

// Export helper function for testing
export const isOriginAllowed = (origin) => {
  if (!origin) return true;
  return getAllowedOrigins().includes(origin);
};
