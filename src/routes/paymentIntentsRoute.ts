import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { verifyCBE, VerifyResult } from '../services/verifyCBE';
import { verifyTelebirr, TelebirrReceipt } from '../services/verifyTelebirr';
import { AppError, ErrorType, sendErrorResponse } from '../utils/errorHandler';
import { prisma } from '../utils/prisma';

// // Interfaces with index signature for Prisma JSON compatibility
// interface VerifyResult {
//   success: boolean;
//   payer?: string;
//   payerAccount?: string;
//   receiver?: string;
//   receiverAccount?: string;
//   amount?: number;
//   date?: string;
//   reference?: string;
//   reason?: string;
//   [key: string]: any;
// }

// interface TelebirrReceipt {
//   success: boolean;
//   data: {
//     payerName?: string;
//     payerTelebirrNo?: string;
//     creditedPartyName?: string;
//     creditedPartyAccountNo?: string;
//     transactionStatus: string;
//     receiptNo?: string;
//     paymentDate?: string;
//     settledAmount?: string;
//     serviceFee?: string;
//     serviceFeeVAT?: string;
//     totalPaidAmount?: string;
//     [key: string]: any;
//   };
//   [key: string]: any;
// }

// Type guard to check if result is TelebirrReceipt
function isTelebirrReceipt(result: VerifyResult | TelebirrReceipt | null): result is TelebirrReceipt {
  return result != null && 'data' in result && 'transactionStatus' in result.data;
}

// Extend Request interface
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
  expectedReceiverAccount: z.string().min(1),
  expectedReceiverName: z.string().min(1).optional(),
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
    const { amount, currency, merchant, paymentMethodType, metadata, idempotencyKey, expectedReceiverAccount, expectedReceiverName } = parsed;

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

    let verificationResult: VerifyResult | TelebirrReceipt | null;
    let status: 'succeeded' | 'failed';

    if (intent.paymentMethodType === 'CBE') {
      if (!intent.expectedReceiverAccount) {
        throw new AppError('Expected receiver account not set for CBE intent', ErrorType.VALIDATION, 400);
      }
      verificationResult = await verifyCBE(reference, intent.expectedReceiverAccount);
      if (!verificationResult || !verificationResult.success) {
        status = 'failed';
      } else {
        // Validate CBE fields
        if (!verificationResult.receiverAccount?.endsWith(intent.expectedReceiverAccount)) {
          throw new AppError('Receiver account mismatch', ErrorType.VALIDATION, 400);
        }
        if (intent.expectedReceiverName && verificationResult.receiver !== intent.expectedReceiverName) {
          throw new AppError('Receiver name mismatch', ErrorType.VALIDATION, 400);
        }
        if (verificationResult.date && new Date(verificationResult.date) < new Date(intent.createdAt)) {
          throw new AppError('Transaction date is before intent creation', ErrorType.VALIDATION, 400);
        }
        if (verificationResult.amount !== intent.amount) {
          throw new AppError(`Verified amount (${verificationResult.amount}) does not match intent amount (${intent.amount})`, ErrorType.VALIDATION, 400);
        }
        status = 'succeeded';
      }
    } else if (intent.paymentMethodType === 'Telebirr') {
      if (!intent.expectedReceiverAccount) {
        throw new AppError('Expected receiver account not set for Telebirr intent', ErrorType.VALIDATION, 400);
      }
      verificationResult = await verifyTelebirr(reference);
      if (!verificationResult || !isTelebirrReceipt(verificationResult) || verificationResult.data.transactionStatus.toLowerCase() !== 'success') {
        status = 'failed';
      } else {
        // Validate Telebirr fields
        const lastFourDigits = intent.expectedReceiverAccount.slice(-4);
        if (!verificationResult.data.creditedPartyAccountNo?.endsWith(lastFourDigits)) {
          throw new AppError('Credited party account mismatch', ErrorType.VALIDATION, 400);
        }
        if (intent.expectedReceiverName && verificationResult.data.creditedPartyName !== intent.expectedReceiverName) {
          throw new AppError('Credited party name mismatch', ErrorType.VALIDATION, 400);
        }
        if (verificationResult.data.paymentDate && new Date(verificationResult.data.paymentDate) < new Date(intent.createdAt)) {
          throw new AppError('Payment date is before intent creation', ErrorType.VALIDATION, 400);
        }
        const verifiedAmount = parseFloat(verificationResult.data.settledAmount?.replace(/[^0-9.]/g, '') || '0');
        if (verifiedAmount !== intent.amount) {
          throw new AppError(`Verified amount (${verifiedAmount}) does not match intent amount (${intent.amount})`, ErrorType.VALIDATION, 400);
        }
        status = 'succeeded';
      }
    } else {
      throw new AppError('Unsupported payment method', ErrorType.VALIDATION, 400);
    }

    if (!verificationResult) {
      throw new AppError('Verification failed', ErrorType.VALIDATION, 400);
    }

    const updatedIntent = await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status,
        verificationDetails: verificationResult as any, // Type assertion for Prisma
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