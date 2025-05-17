import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Interface for API key data
interface ApiKey {
    key: string;
    owner: string;
    createdAt: Date;
    lastUsed?: Date;
    usageCount: number;
}

// In-memory store for API keys (replace with database in production)
const apiKeys: Map<string, ApiKey> = new Map();

// Function to generate a new API key
export const generateApiKey = (owner: string): ApiKey => {
    // Generate a random API key
    const key = Buffer.from(`${owner}-${Date.now()}-${Math.random().toString(36).substring(2)}`)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '');

    const apiKey: ApiKey = {
        key,
        owner,
        createdAt: new Date(),
        usageCount: 0
    };

    // Store the API key
    apiKeys.set(key, apiKey);

    return apiKey;
};

// Function to validate an API key
export const validateApiKey = (key: string): ApiKey | null => {
    return apiKeys.get(key) || null;
};

// Middleware to check API key
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
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

    // Validate API key
    const keyData = validateApiKey(Array.isArray(apiKey) ? apiKey[0] : apiKey);

    if (!keyData) {
        logger.warn(`Invalid API key used: ${typeof apiKey === 'string' ? apiKey.substring(0, 8) : Array.isArray(apiKey) ? apiKey[0].substring(0, 8) : ''}...`);
        return res.status(403).json({ success: false, error: 'Invalid API key' });
    }

    // Update API key usage statistics
    keyData.lastUsed = new Date();
    keyData.usageCount++;

    // Add API key info to request for later use
    (req as any).apiKeyData = keyData;

    next();
};

// Export API keys map for admin routes
export const getApiKeys = (): Map<string, ApiKey> => apiKeys;