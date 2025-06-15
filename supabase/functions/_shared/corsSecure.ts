// 🛡️ SECURITY: Secure CORS configuration for switchfast Supabase Functions

/**
 * 🛡️ SECURITY: Allowed origins whitelist
 * Only these domains are permitted to make requests to our functions
 */
const ALLOWED_ORIGINS = [
  'https://switchfast.io',
  'https://www.switchfast.io',
  'https://app.switchfast.io',
  // Development origins (only in non-production)
  ...(Deno.env.get("ACTIVE_ENVIRONMENT") !== "prod" ? [
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080'
  ] : [])
];

/**
 * 🛡️ SECURITY: Content Security Policy
 */
const CSP_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

/**
 * 🛡️ SECURITY: Generate secure CORS headers based on request origin
 */
export function getSecureCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  
  // 🛡️ SECURITY: Validate origin against whitelist
  let allowedOrigin = null;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    allowedOrigin = origin;
  } else if (referer) {
    // Fallback: check referer header
    const refererUrl = new URL(referer);
    const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
    if (ALLOWED_ORIGINS.includes(refererOrigin)) {
      allowedOrigin = refererOrigin;
    }
  }

  const headers: Record<string, string> = {
    // 🛡️ SECURITY: Strict CORS policy
    'Access-Control-Allow-Origin': allowedOrigin || 'null',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'authorization',
      'x-client-info', 
      'apikey',
      'content-type',
      'x-environment',
      'x-request-id'
    ].join(', '),
    'Access-Control-Max-Age': '86400', // 24 hours
    
    // 🛡️ SECURITY: Additional security headers
    'Content-Security-Policy': CSP_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': [
      'geolocation=()',
      'microphone=()',
      'camera=()',
      'payment=()',
      'usb=()',
      'magnetometer=()',
      'gyroscope=()',
      'accelerometer=()'
    ].join(', '),
    
    // 🛡️ SECURITY: Prevent caching of sensitive responses
    'Cache-Control': 'no-cache, no-store, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    
    // 🛡️ SECURITY: Custom security headers
    'X-Robots-Tag': 'noindex, nofollow',
    'X-API-Version': '1.0',
    'X-Security-Level': 'enhanced'
  };

  return headers;
}

/**
 * 🛡️ SECURITY: Validate request origin and method
 */
export function validateRequest(request: Request): {
  isValid: boolean;
  error?: string;
  headers: Record<string, string>;
} {
  const corsHeaders = getSecureCorsHeaders(request);
  
  // Handle OPTIONS requests (CORS preflight)
  if (request.method === 'OPTIONS') {
    return {
      isValid: true,
      headers: corsHeaders
    };
  }

  // 🛡️ SECURITY: Only allow POST requests for API endpoints
  if (request.method !== 'POST') {
    return {
      isValid: false,
      error: 'Method not allowed',
      headers: corsHeaders
    };
  }

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  
  // 🛡️ SECURITY: Require valid origin for non-preflight requests
  if (!origin && !referer) {
    return {
      isValid: false,
      error: 'Origin header required',
      headers: corsHeaders
    };
  }

  // 🛡️ SECURITY: Validate origin against whitelist
  let hasValidOrigin = false;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    hasValidOrigin = true;
  } else if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = `${refererUrl.protocol}//${refererUrl.host}`;
      if (ALLOWED_ORIGINS.includes(refererOrigin)) {
        hasValidOrigin = true;
      }
    } catch (e) {
      // Invalid referer URL
    }
  }

  if (!hasValidOrigin) {
    return {
      isValid: false,
      error: 'Origin not allowed',
      headers: corsHeaders
    };
  }

  return {
    isValid: true,
    headers: corsHeaders
  };
}

/**
 * 🛡️ SECURITY: Rate limiting storage (in-memory for demo, use Redis in production)
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * 🛡️ SECURITY: Rate limiting check
 */
export function checkRateLimit(
  identifier: string, 
  maxRequests = 100, 
  windowMs = 60000
): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const key = `ratelimit:${identifier}`;
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    const newRecord = { count: 1, resetTime: now + windowMs };
    rateLimitStore.set(key, newRecord);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetTime: newRecord.resetTime
    };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime
    };
  }

  record.count++;
  return {
    allowed: true,
    remaining: maxRequests - record.count,
    resetTime: record.resetTime
  };
}

/**
 * 🛡️ SECURITY: Create secure response with proper headers
 */
export function createSecureResponse(
  data: any,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  const secureHeaders = {
    'Content-Type': 'application/json',
    ...getSecureCorsHeaders(new Request('/', { method: 'POST' })),
    ...headers
  };

  return new Response(JSON.stringify(data), {
    status,
    headers: secureHeaders
  });
}

/**
 * 🛡️ SECURITY: Create error response with security headers
 */
export function createSecureErrorResponse(
  error: string,
  status = 400,
  details?: any,
  headers: Record<string, string> = {}
): Response {
  const errorData = {
    error,
    ...(details && { details }),
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID()
  };

  return createSecureResponse(errorData, status, headers);
}

/**
 * 🛡️ SECURITY: Input sanitization helper
 */
export function sanitizeInput(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  
  return input
    .replace(/[<>'"&]/g, '') // Prevent XSS
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
    .replace(/\0/g, '') // Remove null bytes
    .substring(0, maxLength)
    .trim();
}

/**
 * 🛡️ SECURITY: Email validation
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email) && email.length <= 254;
}