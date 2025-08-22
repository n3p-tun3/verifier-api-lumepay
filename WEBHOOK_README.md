# 🔗 Webhook System Documentation

## Overview

The webhook system allows merchants to receive real-time notifications when payment intent events occur. This enables automated responses to payment status changes without polling the API.

## Features

- ✅ **Real-time notifications** for payment intent events
- ✅ **Secure webhook signatures** for verification
- ✅ **Automatic retries** with exponential backoff
- ✅ **Event filtering** - subscribe only to relevant events
- ✅ **Delivery tracking** - monitor webhook delivery status
- ✅ **Merchant isolation** - webhooks are scoped to API key owners

## Event Types

| Event | Description | Triggered When |
|-------|-------------|----------------|
| `payment_intent.created` | New payment intent created | POST `/intents` |
| `payment_intent.confirmed` | Payment intent successfully confirmed | POST `/intents/:id/confirm` (success) |
| `payment_intent.failed` | Payment intent verification failed | POST `/intents/:id/confirm` (failure) |
| `payment_intent.expired` | Payment intent expired | Automatic (24h TTL) |

## API Endpoints

### Create Webhook Subscription
```http
POST /webhooks
Authorization: x-api-key: YOUR_API_KEY

{
  "url": "https://your-domain.com/webhook",
  "events": ["payment_intent.created", "payment_intent.confirmed"],
  "secret": "optional-custom-secret" // Auto-generated if not provided
}
```

### List Webhook Subscriptions
```http
GET /webhooks
Authorization: x-api-key: YOUR_API_KEY
```

### Get Webhook Subscription
```http
GET /webhooks/:id
Authorization: x-api-key: YOUR_API_KEY
```

### Update Webhook Subscription
```http
PUT /webhooks/:id
Authorization: x-api-key: YOUR_API_KEY

{
  "url": "https://new-domain.com/webhook",
  "events": ["payment_intent.created"],
  "isActive": false
}
```

### Delete Webhook Subscription
```http
DELETE /webhooks/:id
Authorization: x-api-key: YOUR_API_KEY
```

### Regenerate Webhook Secret
```http
POST /webhooks/:id/regenerate-secret
Authorization: x-api-key: YOUR_API_KEY
```

## Webhook Payload

### Payment Intent Created
```json
{
  "id": "webhook_event_id",
  "type": "payment_intent.created",
  "data": {
    "id": "payment_intent_id",
    "amount": 1000,
    "merchant": "merchant_name",
    "paymentMethodType": "CBE",
    "status": "pending",
    "expiresAt": "2025-08-05T19:26:00.000Z",
    "createdAt": "2025-08-04T19:26:00.000Z"
  },
  "created": 1733347560
}
```

### Payment Intent Confirmed
```json
{
  "id": "webhook_event_id",
  "type": "payment_intent.confirmed",
  "data": {
    "id": "payment_intent_id",
    "amount": 1000,
    "merchant": "merchant_name",
    "paymentMethodType": "CBE",
    "status": "succeeded",
    "reference": "FT25217L907J",
    "confirmedAt": "2025-08-04T19:26:00.000Z",
    "verificationDetails": { ... }
  },
  "created": 1733347560
}
```

### Payment Intent Failed
```json
{
  "id": "webhook_event_id",
  "type": "payment_intent.failed",
  "data": {
    "id": "payment_intent_id",
    "amount": 1000,
    "merchant": "merchant_name",
    "paymentMethodType": "CBE",
    "status": "failed",
    "error": "Receiver verification failed - name or account mismatch",
    "verificationDetails": { ... }
  },
  "created": 1733347560
}
```

## Security

### Webhook Signatures

Each webhook includes a signature header for verification:

```http
X-Webhook-Signature: sha256=abc123...
```

### Signature Verification

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', '')),
    Buffer.from(expectedSignature)
  );
}
```

## Retry Logic

- **Automatic retries**: Up to 3 attempts for failed deliveries
- **Exponential backoff**: 1min, 2min, 4min delays
- **Background job**: Runs every 5 minutes to retry failed webhooks
- **Failure tracking**: Monitors webhook health and failure counts

## Best Practices

1. **Handle duplicate events**: Webhooks may be sent multiple times
2. **Verify signatures**: Always verify webhook authenticity
3. **Respond quickly**: Return 2xx status within 10 seconds
4. **Idempotency**: Design your webhook handlers to be idempotent
5. **Error handling**: Log and handle webhook processing errors gracefully

## Example Webhook Handler

```javascript
const express = require('express');
const crypto = require('crypto');

app.post('/webhook', express.json(), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const secret = 'your-webhook-secret';
  
  // Verify signature
  if (!verifyWebhookSignature(req.body, signature, secret)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook
  const { type, data } = req.body;
  
  switch (type) {
    case 'payment_intent.confirmed':
      // Handle successful payment
      console.log(`Payment confirmed: ${data.id}`);
      break;
    case 'payment_intent.failed':
      // Handle failed payment
      console.log(`Payment failed: ${data.id} - ${data.error}`);
      break;
  }
  
  res.status(200).send('OK');
});
```

## Monitoring

- **Webhook delivery status**: Track in `WebhookDelivery` table
- **Failure counts**: Monitor webhook health in `WebhookSubscription`
- **Last triggered**: See when webhooks were last sent
- **Response codes**: Monitor webhook endpoint health

## Rate Limits

- **Webhook delivery**: 10 second timeout per webhook
- **Retry frequency**: Every 5 minutes for failed webhooks
- **Parallel delivery**: Multiple webhooks sent simultaneously per merchant
