import { Router, Request, Response, RequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { verifyCBE, VerifyResult } from '../services/verifyCBE';
import { verifyTelebirr, TelebirrReceipt } from '../services/verifyTelebirr';
import { AppError, ErrorType, sendErrorResponse } from '../utils/errorHandler';
import { prisma } from '../utils/prisma';

// Extend Request interface to include apiKeyData from apiKeyAuth middleware
interface CustomRequest extends Request {
  apiKeyData?: { id: string; key: string; owner: string };
}

const router = Router();
const createIntentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default('ETB'),
  merchant: z.string().min(1),
  paymentMethodType: z.enum(['CBE', 'Telebirr']),
  metadata: z.record(z.string(), z.string()).optional(),
  idempotencyKey: z.string().uuid().optional(),
});

const confirmIntentSchema = z.object({
  reference: z.string().min(1),
  accountSuffix: z.string().optional(),
});

const validateIntentOwner = (req: CustomRequest, merchant: string) => {
  const apiKeyOwner = req.apiKeyData?.owner;
  if (!apiKeyOwner) {
    throw new AppError('API key owner not found', ErrorType.UNAUTHORIZED, 401);
  }
  if (apiKeyOwner !== merchant) {
    throw new AppError('API key does not match merchant', ErrorType.FORBIDDEN, 403);
  }
};

// Create Payment Intent
router.post('/', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    const parsed = createIntentSchema.parse(req.body);
    const { amount, currency, merchant, paymentMethodType, metadata, idempotencyKey } = parsed;

    validateIntentOwner(req, merchant);

    if (idempotencyKey) {
      const existing = await prisma.paymentIntent.findFirst({
        where: { idempotencyKey },
      });
      if (existing) {
        logger.info(`Returning existing intent for idempotencyKey: ${idempotencyKey}`);
        res.status(200).json({ success: true, data: existing });
        return;
      }
    }

    const intent = await prisma.paymentIntent.create({
      data: {
        id: uuidv4(),
        amount,
        currency,
        merchant,
        paymentMethodType,
        metadata: metadata || {},
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        idempotencyKey: idempotencyKey || uuidv4(),
        apiKeyId: req.apiKeyData!.id,
      },
    });

    logger.info(`Created payment intent ${intent.id} for merchant ${merchant}`);
    res.status(201).json({ success: true, data: intent });
  } catch (error) {
    logger.error('Error creating payment intent:', error);
    sendErrorResponse(res, error);
  }
});

// Get Payment Intent
router.get('/:id', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    const intent = await prisma.paymentIntent.findUnique({
      where: { id: req.params.id },
    });
    if (!intent) {
      throw new AppError('Payment intent not found', ErrorType.NOT_FOUND, 404);
    }

    validateIntentOwner(req, intent.merchant);

    res.json({ success: true, data: intent });
  } catch (error) {
    logger.error('Error fetching payment intent:', error);
    sendErrorResponse(res, error);
  }
});

// Confirm Payment Intent
router.post('/:id/confirm', async (req: CustomRequest, res: Response): Promise<void> => {
  try {
    const parsed = confirmIntentSchema.parse(req.body);
    const { reference, accountSuffix } = parsed;

    const intent = await prisma.paymentIntent.findUnique({
      where: { id: req.params.id },
    });
    if (!intent) {
      throw new AppError('Payment intent not found', ErrorType.NOT_FOUND, 404);
    }

    validateIntentOwner(req, intent.merchant);

    if (intent.status !== 'pending') {
      throw new AppError('Intent is not in pending state', ErrorType.VALIDATION, 400);
    }
    if (intent.expiresAt < new Date()) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'expired' },
      });
      throw new AppError('Payment intent has expired', ErrorType.VALIDATION, 400);
    }

    let verificationResult: VerifyResult | TelebirrReceipt | null;
    if (intent.paymentMethodType === 'CBE') {
      if (!accountSuffix) {
        throw new AppError('Account suffix required for CBE verification', ErrorType.VALIDATION, 400);
      }
      verificationResult = await verifyCBE(reference, accountSuffix);
    } else if (intent.paymentMethodType === 'Telebirr') {
      verificationResult = await verifyTelebirr(reference);
    } else {
      throw new AppError('Unsupported payment method', ErrorType.VALIDATION, 400);
    }

    if (!verificationResult) {
      throw new AppError('Verification failed', ErrorType.VALIDATION, 400);
    }

    const status = ('success' in verificationResult && verificationResult.success) || 
                   ('transactionStatus' in verificationResult && verificationResult.transactionStatus.toLowerCase() === 'success') 
                   ? 'succeeded' : 'failed';
    
    const verifiedAmount = 'amount' in verificationResult ? verificationResult.amount :
                         'settledAmount' in verificationResult ? parseFloat(verificationResult.settledAmount.replace(/[^0-9.]/g, '')) :
                         undefined;

    if (status === 'succeeded' && verifiedAmount !== intent.amount) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'failed', verificationDetails: { error: 'Amount mismatch' } },
      });
      throw new AppError(`Verified amount (${verifiedAmount}) does not match intent amount (${intent.amount})`, ErrorType.VALIDATION, 400);
    }

    const updatedIntent = await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status,
        verificationDetails: JSON.stringify(verificationResult),
        confirmedAt: status === 'succeeded' ? new Date() : undefined,
      },
    });

    logger.info(`Confirmed payment intent ${intent.id} with status ${status}`);
    res.json({ success: true, data: updatedIntent });
  } catch (error) {
    logger.error('Error confirming payment intent:', error);
    sendErrorResponse(res, error);
  }
});

export default router;