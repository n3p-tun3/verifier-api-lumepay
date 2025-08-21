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
  merchant: z.string().min(1),
  paymentMethodType: z.enum(['CBE', 'Telebirr']),
  metadata: z.record(z.string(), z.string()).optional(),
  idempotencyKey: z.string().uuid().optional(),
  expectedReceiverAccount: z.string().min(1),
  expectedReceiverName: z.string().min(1),
});

const confirmIntentSchema = z.object({
  reference: z.string().min(1),
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
    const { amount, merchant, paymentMethodType, metadata, idempotencyKey, expectedReceiverAccount, expectedReceiverName } = parsed;

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
        merchant,
        paymentMethodType,
        metadata: metadata || {},
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        idempotencyKey: idempotencyKey || uuidv4(),
        apiKeyId: req.apiKeyData!.id,
        expectedReceiverAccount,
        expectedReceiverName,
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
    const { reference } = parsed;

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

    // Check if reference has already been used
    const existingConfirmedIntent = await prisma.paymentIntent.findFirst({
      where: {
        reference: reference,
        status: { in: ['succeeded', 'failed'] },
      },
    });
    if (existingConfirmedIntent) {
      throw new AppError('Reference has already been used for another payment intent', ErrorType.VALIDATION, 400);
    }

    let verificationResult: VerifyResult | TelebirrReceipt | null;
    if (intent.paymentMethodType === 'CBE') {
      // For CBE, use the expected receiver account (suffix) to query
      verificationResult = await verifyCBE(reference, intent.expectedReceiverAccount);
    } else if (intent.paymentMethodType === 'Telebirr') {
      verificationResult = await verifyTelebirr(reference);
    } else {
      throw new AppError('Unsupported payment method', ErrorType.VALIDATION, 400);
    }

    if (!verificationResult) {
      throw new AppError('Verification failed', ErrorType.VALIDATION, 400);
    }

    // Verify merchant identity and payment details
    let verificationPassed = false;
    let verificationError = '';

    if (intent.paymentMethodType === 'CBE') {
      const cbeResult = verificationResult as VerifyResult;
      if (!cbeResult.success) {
        verificationError = 'CBE verification failed';
      } else {
        // Verify receiver name and account
        const receiverNameMatch = cbeResult.receiver?.toLowerCase() === intent.expectedReceiverName?.toLowerCase();
        const receiverAccountMatch = cbeResult.receiverAccount?.endsWith(intent.expectedReceiverAccount);
        
        if (!receiverNameMatch || !receiverAccountMatch) {
          verificationError = 'Receiver verification failed - name or account mismatch';
        } else {
          verificationPassed = true;
        }
      }
    } else if (intent.paymentMethodType === 'Telebirr') {
      const telebirrResult = verificationResult as TelebirrReceipt;
      if (telebirrResult.transactionStatus.toLowerCase() !== 'completed') {
        verificationError = 'Telebirr transaction not completed';
      } else {
        // Verify receiver name and last 4 digits of account
        const receiverNameMatch = telebirrResult.creditedPartyName.toLowerCase() === intent.expectedReceiverName?.toLowerCase();
        const receiverAccountMatch = telebirrResult.creditedPartyAccountNo.endsWith(intent.expectedReceiverAccount.slice(-4));
        
        if (!receiverNameMatch || !receiverAccountMatch) {
          verificationError = 'Receiver verification failed - name or account mismatch';
        } else {
          verificationPassed = true;
        }
      }
    }

    if (!verificationPassed) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { 
          status: 'failed', 
          verificationDetails: { error: verificationError } 
        },
      });
      throw new AppError(verificationError, ErrorType.VALIDATION, 400);
    }

    // Verify amount matches
    let verifiedAmount: number;
    if (intent.paymentMethodType === 'CBE') {
      const cbeResult = verificationResult as VerifyResult;
      verifiedAmount = cbeResult.amount || 0;
    } else {
      const telebirrResult = verificationResult as TelebirrReceipt;
      // Use totalPaidAmount for Telebirr (what customer actually paid)
      verifiedAmount = parseFloat(telebirrResult.totalPaidAmount.replace(/[^0-9.]/g, ''));
    }

    if (verifiedAmount !== intent.amount) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { 
          status: 'failed', 
          verificationDetails: { error: `Amount mismatch: expected ${intent.amount}, got ${verifiedAmount}` } 
        },
      });
      throw new AppError(`Verified amount (${verifiedAmount}) does not match intent amount (${intent.amount})`, ErrorType.VALIDATION, 400);
    }

    const updatedIntent = await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'succeeded',
        reference: reference,
        verificationDetails: JSON.stringify(verificationResult),
        confirmedAt: new Date(),
      },
    });

    logger.info(`Confirmed payment intent ${intent.id} with status succeeded`);
    res.json({ success: true, data: updatedIntent });
  } catch (error) {
    logger.error('Error confirming payment intent:', error);
    sendErrorResponse(res, error);
  }
});

export default router;