import { Router, Request, Response, RequestHandler } from 'express';
import { generateApiKey, getApiKeys } from '../middleware/apiKeyAuth';
import { getUsageStats } from '../middleware/requestLogger';
import logger from '../utils/logger';

const router = Router();

// Admin secret key for authentication (use environment variable in production)
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-this-secret-key';

// Middleware to check admin authentication
const checkAdminAuth = (req: Request, res: Response, next: Function) => {
    const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
    
    // Add debug logging
    console.log('Expected admin key:', ADMIN_SECRET);
    console.log('Received admin key:', adminKey);
    
    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, error: 'Unauthorized admin access' });
    }

    next();
};

// Generate a new API key
router.post('/api-keys', checkAdminAuth as RequestHandler, async (req: Request, res: Response): Promise<void> => {
    const { owner } = req.body;

    if (!owner) {
        res.status(400).json({ success: false, error: 'Owner name is required' });
        return;
    }

    try {
        const apiKey = generateApiKey(owner);
        logger.info(`New API key generated for ${owner}`);

        res.status(201).json({
            success: true,
            data: {
                key: apiKey.key,
                owner: apiKey.owner,
                createdAt: apiKey.createdAt
            }
        });
    } catch (err) {
        logger.error('Error generating API key:', err);
        res.status(500).json({ success: false, error: 'Failed to generate API key' });
    }
});

// List all API keys (admin only)
router.get('/api-keys', checkAdminAuth as RequestHandler, (req: Request, res: Response) => {
    const apiKeys = getApiKeys();
    const keyList = Array.from(apiKeys.values()).map(key => ({
        key: key.key.substring(0, 8) + '...',  // Only show first 8 chars for security
        owner: key.owner,
        createdAt: key.createdAt,
        lastUsed: key.lastUsed,
        usageCount: key.usageCount
    }));

    res.json({ success: true, data: keyList });
});

// Get usage statistics
router.get('/stats', checkAdminAuth as RequestHandler, (req: Request, res: Response) => {
    const stats = getUsageStats();

    // Convert Maps to objects for JSON serialization
    const endpointStats = {};
    stats.endpointStats.forEach((value, key) => {
        (endpointStats as Record<string, unknown>)[key] = value;
    });

    const ipStats = {};
    stats.ipStats.forEach((value, key) => {
        (ipStats as Record<string, unknown>)[key] = value;
    });

    res.json({
        success: true,
        data: {
            totalRequests: stats.totalRequests,
            endpointStats,
            ipStats
        }
    });
});

export default router;