import axios, { AxiosResponse, AxiosError } from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger';
import { prisma } from '../utils/prisma';

export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  created: number;
}

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
}

export class WebhookService {
  /**
   * Send webhook to a single subscription
   */
  static async sendWebhook(
    webhookId: string,
    eventType: string,
    eventData: any
  ): Promise<WebhookDeliveryResult> {
    try {
      // Get webhook subscription
      const webhook = await prisma.webhookSubscription.findUnique({
        where: { id: webhookId },
      });

      if (!webhook || !webhook.isActive) {
        return { success: false, error: 'Webhook not found or inactive' };
      }

      // Check if webhook is subscribed to this event type
      if (!webhook.events.includes(eventType)) {
        return { success: false, error: 'Event type not subscribed' };
      }

      // Create webhook event
      const webhookEvent: WebhookEvent = {
        id: crypto.randomUUID(),
        type: eventType,
        data: eventData,
        created: Math.floor(Date.now() / 1000),
      };

      // Generate signature
      const signature = this.generateSignature(webhookEvent, webhook.secret);

      // Send webhook
      const response: AxiosResponse = await axios.post(webhook.url, webhookEvent, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'User-Agent': 'LumePay-Webhooks/1.0',
        },
        timeout: 10000, // 10 second timeout
      });

      // Record successful delivery
      await this.recordDelivery(webhookId, eventType, eventData, 'delivered', response.status, response.data);

      // Update webhook stats
      await prisma.webhookSubscription.update({
        where: { id: webhookId },
        data: {
          lastTriggered: new Date(),
          failureCount: 0, // Reset failure count on success
        },
      });

      logger.info(`Webhook delivered successfully to ${webhook.url}`, {
        webhookId,
        eventType,
        statusCode: response.status,
      });

      return {
        success: true,
        statusCode: response.status,
        responseBody: JSON.stringify(response.data),
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status;
      const responseBody = axiosError.response?.data;

      // Record failed delivery
      await this.recordDelivery(
        webhookId,
        eventType,
        eventData,
        'failed',
        statusCode,
        responseBody
      );

      // Increment failure count
      await prisma.webhookSubscription.update({
        where: { id: webhookId },
        data: {
          failureCount: { increment: 1 },
        },
      });

      logger.error(`Webhook delivery failed to ${webhookId}`, {
        webhookId,
        eventType,
        statusCode,
        error: axiosError.message,
      });

      return {
        success: false,
        statusCode,
        responseBody: responseBody ? JSON.stringify(responseBody) : undefined,
        error: axiosError.message,
      };
    }
  }

  /**
   * Send webhook to all subscriptions for a merchant
   */
  static async sendWebhookToMerchant(
    merchant: string,
    eventType: string,
    eventData: any
  ): Promise<void> {
    try {
      // Get all active webhook subscriptions for the merchant
      const webhooks = await prisma.webhookSubscription.findMany({
        where: {
          merchant,
          isActive: true,
          events: { has: eventType },
        },
      });

      logger.info(`Sending ${eventType} webhook to ${webhooks.length} subscriptions for merchant ${merchant}`);

      // Send webhooks in parallel
      const promises = webhooks.map((webhook: any) =>
        this.sendWebhook(webhook.id, eventType, eventData)
      );

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`Error sending webhooks to merchant ${merchant}`, error);
    }
  }

  /**
   * Retry failed webhook deliveries
   */
  static async retryFailedWebhooks(): Promise<void> {
    try {
      const failedDeliveries = await prisma.webhookDelivery.findMany({
        where: {
          status: 'failed',
          attempts: { lt: 3 }, // Max 3 attempts
          nextRetryAt: { lte: new Date() },
        },
        include: {
          webhookSubscription: true,
        },
      });

      logger.info(`Retrying ${failedDeliveries.length} failed webhook deliveries`);

      for (const delivery of failedDeliveries) {
        try {
          // Check if webhook is still active
          if (!delivery.webhookSubscription.isActive) {
            await prisma.webhookDelivery.update({
              where: { id: delivery.id },
              data: { status: 'failed' },
            });
            continue;
          }

          // Retry delivery
          const result = await this.sendWebhook(
            delivery.webhookSubscriptionId,
            delivery.eventType,
            delivery.eventData
          );

          if (result.success) {
            // Mark as delivered
            await prisma.webhookDelivery.update({
              where: { id: delivery.id },
              data: {
                status: 'delivered',
                deliveredAt: new Date(),
              },
            });
          } else {
            // Increment attempts and schedule next retry
            const attempts = delivery.attempts + 1;
            const nextRetryAt = new Date(Date.now() + Math.pow(2, attempts) * 60000); // Exponential backoff

            await prisma.webhookDelivery.update({
              where: { id: delivery.id },
              data: {
                attempts,
                nextRetryAt: attempts < 3 ? nextRetryAt : null,
                status: attempts >= 3 ? 'failed' : 'pending',
              },
            });
          }
        } catch (error) {
          logger.error(`Error retrying webhook delivery ${delivery.id}`, error);
        }
      }
    } catch (error) {
      logger.error('Error in retryFailedWebhooks', error);
    }
  }

  /**
   * Generate webhook signature
   */
  private static generateSignature(event: WebhookEvent, secret: string): string {
    const payload = JSON.stringify(event);
    return crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Record webhook delivery attempt
   */
  private static async recordDelivery(
    webhookId: string,
    eventType: string,
    eventData: any,
    status: string,
    responseCode?: number,
    responseBody?: any
  ): Promise<void> {
    try {
      await prisma.webhookDelivery.create({
        data: {
          webhookSubscriptionId: webhookId,
          eventType,
          eventData,
          status,
          responseCode,
          responseBody: responseBody ? JSON.stringify(responseBody) : null,
          attempts: 1,
        },
      });
    } catch (error) {
      logger.error('Error recording webhook delivery', error);
    }
  }
}
