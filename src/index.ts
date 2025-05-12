import express, { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import cors from 'cors';
import CBERouter from './routes/verifyCBERoute';
import telebirrRouter from './routes/verifyTelebirrRoute';
import logger from './utils/logger';
import { verifyImageHandler } from "./services/verifyImage";
import { requestLogger } from './middleware/requestLogger';

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

// ✅ Attach router to this path
app.use('/verify-cbe', CBERouter);
app.use('/verify-telebirr', telebirrRouter);

// Fix: Apply middleware functions individually instead of spreading the array
app.post("/verify-image", verifyImageHandler[0], verifyImageHandler[1]);

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
