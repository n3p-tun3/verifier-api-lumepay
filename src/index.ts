import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import CBERouter from './routes/verifyCBERoute';
import telebirrRouter from './routes/verifyTelebirrRoute';
import adminRouter from './routes/adminRoute';
import logger from './utils/logger';
import { verifyImageHandler } from "./services/verifyImage";
import { requestLogger } from './middleware/requestLogger';
import { apiKeyAuth } from './middleware/apiKeyAuth';

const app = express();
const PORT = process.env.PORT || 3001;

// Add environment info to startup log
logger.info(`Starting server in ${process.env.NODE_ENV || 'development'} mode`);
logger.info(`Node version: ${process.version}`);
logger.info(`Platform: ${process.platform}`);

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
// Remove this line since we already registered admin routes
// app.use('/admin', adminRouter);

// Fix: Apply middleware functions individually instead of spreading the array
app.post("/verify-image", verifyImageHandler[0], verifyImageHandler[1]);

// Add a root route handler to display API information
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({
        message: "Verifier API is running",
        version: "1.0.0",
        endpoints: [
            "/verify-cbe",
            "/verify-telebirr",
            "/verify-image"
        ],
        adminEndpoints: [
            "/admin/api-keys",
            "/admin/stats"
        ],
        health: "/health",
        documentation: "https://github.com/Vixen878/verifier-api"
    });
});

// Global error handler - properly typed as an error handler
const globalErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' ? undefined : err.message
    });
};

app.use(globalErrorHandler);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    logger.info(`🚀 Server running at http://localhost:${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection at:', { promise, reason });
});
