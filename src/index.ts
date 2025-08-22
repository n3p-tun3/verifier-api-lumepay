import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import CBERouter from './routes/verifyCBERoute';
import telebirrRouter from './routes/verifyTelebirrRoute';
import adminRouter from './routes/adminRoute';
import paymentIntentsRouter from './routes/paymentIntentsRoute';
import webhookRouter from './routes/webhookRoute';
import logger from './utils/logger';
import { verifyImageHandler } from "./services/verifyImage";
import { requestLogger, initializeStatsCache } from './middleware/requestLogger';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { prisma, disconnectPrisma } from './utils/prisma';
import { WebhookService } from './services/webhookService';

const app = express();
const PORT = process.env.PORT || 3001;

// Add environment info to startup log
logger.info(`Starting server in ${process.env.NODE_ENV || 'development'} mode`);
logger.info(`Node version: ${process.version}`);
logger.info(`Platform: ${process.platform}`);

// Initialize database connection and cache
(async () => {
    try {
        // Test database connection
        await prisma.$connect();
        logger.info('Connected to database successfully');

        // Initialize stats cache from database
        await initializeStatsCache();
        
        // Start background job for retrying failed webhooks
        setInterval(async () => {
            try {
                await WebhookService.retryFailedWebhooks();
            } catch (error) {
                logger.error('Error in webhook retry job:', error);
            }
        }, 5 * 60 * 1000); // Run every 5 minutes
    } catch (error) {
        logger.error('Failed to initialize database connection:', error);
        process.exit(1);
    }
})();

app.use(cors());
app.use(express.json());

// Add request logging middleware
app.use(requestLogger);

// Register admin routes BEFORE API key authentication
app.use('/admin', adminRouter);

// Add API key authentication middleware (will not affect admin routes)
app.use(apiKeyAuth as express.RequestHandler);

// Error handling for JSON parsing - properly typed as an error handler
const jsonErrorHandler: ErrorRequestHandler = async (err, req, res, next): Promise<void> => {
    if (err instanceof SyntaxError && 'body' in err) {
        logger.error('JSON parsing error:', err);
        res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
        return;
    }
    next(err);
};

app.use(jsonErrorHandler);

// ✅ Attach routers to paths
app.use('/verify-cbe', CBERouter);
app.use('/verify-telebirr', telebirrRouter);
app.post('/verify-image', verifyImageHandler);
app.use('/intents', paymentIntentsRouter);
app.use('/webhooks', webhookRouter);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
    res.json({
        name: 'LumePay - Payment Gateway',
        version: '1.0.0',
        endpoints: [
            '/verify-cbe',
            '/verify-telebirr',
            '/verify-image',
            '/intents',
            '/webhooks'
        ]
    });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start the server
const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = async () => {
    logger.info('Shutting down server...');
    server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectPrisma();
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
