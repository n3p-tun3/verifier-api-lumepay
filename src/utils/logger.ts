import { createLogger, format, transports, Logger } from "winston";
import 'winston-daily-rotate-file';

const { combine, timestamp, printf, errors, json, colorize } = format;

// Custom format for detailed logging
const myFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
    let log = `[${timestamp}] ${level.toUpperCase()}: ${message}`;

    // Add stack trace for errors
    if (stack) {
        log += `\n${stack}`;
    }

    // Add metadata if present
    if (Object.keys(metadata).length > 0) {
        log += `\n${JSON.stringify(metadata, null, 2)}`;
    }

    return log;
});

// Create daily rotate file transports
const errorRotateFile = new transports.DailyRotateFile({
    filename: 'logs/error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '5m',
    maxFiles: '14d',
    format: combine(
        errors({ stack: true }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        myFormat
    )
});

const combinedRotateFile = new transports.DailyRotateFile({
    filename: 'logs/combined-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '5m',
    maxFiles: '14d',
    format: combine(
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        myFormat
    )
});

// Create logger with enhanced configuration
const logger = createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
    format: combine(
        errors({ stack: true }), // Capture stack traces
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        myFormat
    ),
    defaultMeta: { service: 'verifier-api' }, // Add service name to all logs
    transports: [
        // Console transport with colors for development
        new transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
                myFormat
            )
        }),
        errorRotateFile,
        combinedRotateFile
    ],
    // Don't exit on uncaught exceptions
    exitOnError: false
});

// Define a custom type for our extended logger
interface CustomLogger extends Omit<Logger, 'stream'> {
    stream?: { write(message: string): void };
}

// Add a stream for Morgan if you're using Express
const customLogger = logger as unknown as CustomLogger;
customLogger.stream = {
    write: (message: string) => {
        logger.info(message.trim());
    }
};

export default customLogger;
