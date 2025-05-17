import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// In-memory usage statistics
const usageStats = {
  totalRequests: 0,
  endpointStats: new Map<string, {
    count: number,
    successCount: number,
    failureCount: number,
    avgResponseTime: number
  }>(),
  ipStats: new Map<string, number>()
};

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
    query: Object.keys(req.query).length ? req.query : undefined,
    apiKey: (req as any).apiKeyData ? (req as any).apiKeyData.owner : 'none'
  });
  
  // Update usage statistics
  usageStats.totalRequests++;
  
  // Track by endpoint
  const endpoint = `${req.method} ${req.path}`;
  if (!usageStats.endpointStats.has(endpoint)) {
    usageStats.endpointStats.set(endpoint, {
      count: 0,
      successCount: 0,
      failureCount: 0,
      avgResponseTime: 0
    });
  }
  const endpointStat = usageStats.endpointStats.get(endpoint)!;
  endpointStat.count++;
  
  // Track by IP address
  const ipCount = usageStats.ipStats.get(req.ip ?? '') || 0;
  usageStats.ipStats.set(req.ip ?? '', ipCount + 1);
  
  // Use the 'finish' event to capture response completion
  res.on('finish', () => {
    const responseTime = Date.now() - start;
    const endpointStat = usageStats.endpointStats.get(endpoint)!;

    if (res.statusCode < 400) {
      endpointStat.successCount++;
    } else {
      endpointStat.failureCount++;
    }

    endpointStat.avgResponseTime = 
      (endpointStat.avgResponseTime * (endpointStat.count - 1) + responseTime) / endpointStat.count;

    logger.info(`[${requestId}] Response sent in ${responseTime}ms with status ${res.statusCode}`, {
      statusCode: res.statusCode,
      responseTime,
      contentLength: res.get('Content-Length') || 'unknown',
      apiKey: (req as any).apiKeyData?.key?.substring(0, 8) || 'none'
    });

    if (res.statusCode >= 400) {
      logger.warn(`[${requestId}] Error occurred with status ${res.statusCode}`);
    }
  });
  
  next();
};

// Export usage statistics for admin routes
export const getUsageStats = () => usageStats;