import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);
  
  // Log request details
  logger.info(`[${requestId}] Incoming ${req.method} request to ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    query: Object.keys(req.query).length ? req.query : undefined
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    const responseTime = Date.now() - start;
    const contentLength = body ? body.length : 0;
    
    logger.info(`[${requestId}] Response sent in ${responseTime}ms with status ${res.statusCode}`, {
      statusCode: res.statusCode,
      responseTime,
      contentLength
    });
    
    // If error response, log more details
    if (res.statusCode >= 400) {
      logger.warn(`[${requestId}] Error response details:`, {
        statusCode: res.statusCode,
        responseBody: typeof body === 'string' ? body : JSON.stringify(body)
      });
    }
    
    return originalSend.call(this, body);
  };
  
  next();
};