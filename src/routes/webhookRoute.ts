import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import logger from '../utils/logger';
import { AppError, ErrorType, sendErrorResponse } from '../utils/errorHandler';
import { prisma } from '../utils/prisma';

// Extend Request interface to include apiKeyData from apiKeyAuth middleware
interface CustomRequest extends Request {
  apiKeyData?: { id: string; key: string; owner: string };
}

const router = Router();

// Webhook subscription schemas
const createWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(['payment_intent.created', 'payment_intent.confirmed', 'payment_intent.failed', 'payment_intent.expired'])),
  secret: z.string().min(16).optional(), // Optional custom secret, will generate if not provided
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(['payment_intent.created', 'payment_intent.confirmed', 'payment_intent.failed', 'payment_intent.expired'])).optional(),
  secret: z.string().min(16).optional(),
  isActive: z.boolean().optional(),
});

// Create webhook subscription
router.post('/', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    const parsed = createWebhookSchema.parse(req.body);
    const { url, events, secret } = parsed;

    if (!req.apiKeyData) {
      throw new AppError('API key not found', ErrorType.UNAUTHORIZED, 401);
    }

    // Generate secret if not provided
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');

    const webhook = await prisma.webhookSubscription.create({
      data: {
        url,
        events,
        secret: webhookSecret,
        merchant: req.apiKeyData.owner,
        apiKeyId: req.apiKeyData.id,
      },
    });

    logger.info(`Created webhook subscription ${webhook.id} for merchant ${req.apiKeyData.owner}`);
    
    // Return webhook data without the secret
    const { secret: _, ...webhookData } = webhook;
    res.status(201).json({ success: true, data: webhookData });
  } catch (error) {
    logger.error('Error creating webhook subscription:', error);
    sendErrorResponse(res, error);
  }
});

// List webhook subscriptions
router.get('/', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    if (!req.apiKeyData) {
      throw new AppError('API key not found', ErrorType.UNAUTHORIZED, 401);
    }

    const webhooks = await prisma.webhookSubscription.findMany({
      where: { apiKeyId: req.apiKeyData.id },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        lastTriggered: true,
        failureCount: true,
        // Don't include secret for security
      },
    });

    res.json({ success: true, data: webhooks });
  } catch (error) {
    logger.error('Error fetching webhook subscriptions:', error);
    sendErrorResponse(res, error);
  }
});

// Get webhook subscription by ID
router.get('/:id', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    if (!req.apiKeyData) {
      throw new AppError('API key not found', ErrorType.UNAUTHORIZED, 401);
    }

    const webhook = await prisma.webhookSubscription.findFirst({
      where: { 
        id: req.params.id,
        apiKeyId: req.apiKeyData.id, // Ensure ownership
      },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        lastTriggered: true,
        failureCount: true,
        // Don't include secret for security
      },
    });

    if (!webhook) {
      throw new AppError('Webhook subscription not found', ErrorType.NOT_FOUND, 404);
    }

    res.json({ success: true, data: webhook });
  } catch (error) {
    logger.error('Error fetching webhook subscription:', error);
    sendErrorResponse(res, error);
  }
});

// Update webhook subscription
router.put('/:id', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    const parsed = updateWebhookSchema.parse(req.body);
    
    if (!req.apiKeyData) {
      throw new AppError('API key not found', ErrorType.UNAUTHORIZED, 401);
    }

    // Check ownership
    const existingWebhook = await prisma.webhookSubscription.findFirst({
      where: { 
        id: req.params.id,
        apiKeyId: req.apiKeyData.id,
      },
    });

    if (!existingWebhook) {
      throw new AppError('Webhook subscription not found', ErrorType.NOT_FOUND, 404);
    }

    const updateData: any = { ...parsed };
    
    // Generate new secret if requested
    if (parsed.secret === '') {
      updateData.secret = crypto.randomBytes(32).toString('hex');
    }

    const updatedWebhook = await prisma.webhookSubscription.update({
      where: { id: req.params.id },
      data: updateData,
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        lastTriggered: true,
        failureCount: true,
        // Don't include secret for security
      },
    });

    logger.info(`Updated webhook subscription ${req.params.id}`);
    res.json({ success: true, data: updatedWebhook });
  } catch (error) {
    logger.error('Error updating webhook subscription:', error);
    sendErrorResponse(res, error);
  }
});

// Delete webhook subscription
router.delete('/:id', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    if (!req.apiKeyData) {
      throw new AppError('API key not found', ErrorType.UNAUTHORIZED, 401);
    }

    // Check ownership
    const existingWebhook = await prisma.webhookSubscription.findFirst({
      where: { 
        id: req.params.id,
        apiKeyId: req.apiKeyData.id,
      },
    });

    if (!existingWebhook) {
      throw new AppError('Webhook subscription not found', ErrorType.NOT_FOUND, 404);
    }

    await prisma.webhookSubscription.delete({
      where: { id: req.params.id },
    });

    logger.info(`Deleted webhook subscription ${req.params.id}`);
    res.json({ success: true, message: 'Webhook subscription deleted' });
  } catch (error) {
    logger.error('Error deleting webhook subscription:', error);
    sendErrorResponse(res, error);
  }
});

// Regenerate webhook secret
router.post('/:id/regenerate-secret', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    if (!req.apiKeyData) {
      throw new AppError('API key not found', ErrorType.UNAUTHORIZED, 401);
    }

    // Check ownership
    const existingWebhook = await prisma.webhookSubscription.findFirst({
      where: { 
        id: req.params.id,
        apiKeyId: req.apiKeyData.id,
      },
    });

    if (!existingWebhook) {
      throw new AppError('Webhook subscription not found', ErrorType.NOT_FOUND, 404);
    }

    const newSecret = crypto.randomBytes(32).toString('hex');
    
    await prisma.webhookSubscription.update({
      where: { id: req.params.id },
      data: { secret: newSecret },
    });

    logger.info(`Regenerated secret for webhook subscription ${req.params.id}`);
    res.json({ success: true, message: 'Webhook secret regenerated' });
  } catch (error) {
    logger.error('Error regenerating webhook secret:', error);
    sendErrorResponse(res, error);
  }
});

export default router;
