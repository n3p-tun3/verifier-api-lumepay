import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { prisma } from '../utils/prisma';
import { AppError, ErrorType, sendErrorResponse } from '../utils/errorHandler';

// Function to generate a new API key
export const generateApiKey = async (owner: string) => {
  // Generate a random API key
  const key = Buffer.from(`${owner}-${Date.now()}-${Math.random().toString(36).substring(2)}`)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '');

  try {
    // Create API key in database
    const apiKey = await prisma.apiKey.create({
      data: {
        key,
        owner,
        usageCount: 0,
        isActive: true
      }
    });

    return apiKey;
  } catch (error) {
    logger.error('Error generating API key:', error);
    throw error;
  }
};

// Function to validate an API key
export const validateApiKey = async (key: string) => {
  try {
    return await prisma.apiKey.findUnique({
      where: { key, isActive: true }
    });
  } catch (error) {
    logger.error('Error validating API key:', error);
    throw error;
  }
};

// Middleware to check API key
export const apiKeyAuth = async (req: Request, res: Response, next: NextFunction) => {
  // Skip API key check for certain routes
  if (req.path === '/' || req.path === '/health' || req.path.startsWith('/admin')) {
    return next();
  }

  // Get API key from header or query parameter
  const apiKey = req.headers['x-api-key'] || req.query.apiKey as string;

  if (!apiKey) {
    logger.warn(`API request without API key: ${req.method} ${req.path}`);
    return res.status(401).json({ success: false, error: 'API key is required' });
  }

  try {
    // Validate API key
    const keyString = Array.isArray(apiKey) ? apiKey[0] : apiKey;
    const keyData = await validateApiKey(keyString);

    if (!keyData) {
      logger.warn(`Invalid API key used: ${typeof keyString === 'string' ? keyString.substring(0, 8) : ''}...`);
      return res.status(403).json({ success: false, error: 'Invalid API key' });
    }

    // Update API key usage statistics
    await prisma.apiKey.update({
      where: { id: keyData.id },
      data: {
        lastUsed: new Date(),
        usageCount: { increment: 1 }
      }
    });

    // Add API key info to request for later use
    (req as any).apiKeyData = keyData;

    next();
  } catch (error) {
    logger.error('Error validating API key:', error);
    sendErrorResponse(res, error);
  }
};

// Get all API keys
export const getApiKeys = async () => {
  try {
    return await prisma.apiKey.findMany();
  } catch (error) {
    logger.error('Error fetching API keys:', error);
    throw error;
  }
};