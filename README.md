# LumePay - Payment Gateway

A modern payment gateway supporting Commercial Bank of Ethiopia (CBE) and Telebirr mobile money payments. LumePay provides secure payment processing, real-time verification, and comprehensive merchant tools.

## Overview

LumePay transforms how businesses handle digital payments. Built on a foundation of secure payment verification, it offers a complete payment gateway solution that integrates seamlessly with existing financial infrastructure.

> **Disclaimer**: This is **not an official API**. We are **not affiliated with Ethio Telecom, Telebirr, or Commercial Bank of Ethiopia (CBE)**. This tool is built for personal and developer utility purposes only and scrapes publicly available data.

### Key Features

- **Multi-Payment Support**: CBE bank transfers and Telebirr mobile money
- **Payment Intents**: Stripe-like payment intent system with secure verification
- **Real-time Webhooks**: Instant payment status notifications
- **Merchant Management**: Comprehensive API key and subscription management
- **Security First**: Built-in fraud prevention and verification systems
- **Developer Friendly**: RESTful API with comprehensive documentation

## Architecture

LumePay operates as a post-payment verification system, ensuring security by verifying actual bank and mobile money transactions rather than initiating charges. This approach provides:

- **Enhanced Security**: No direct access to customer funds
- **Compliance**: Works within existing financial regulations
- **Reliability**: Leverages proven banking infrastructure
- **Transparency**: Full audit trail of all payment verifications

### What We've Built

- **Payment Intent System**: Stripe-like payment intents with secure verification
- **Real-time Webhooks**: Instant payment status notifications to merchants
- **Multi-payment Support**: CBE bank transfers and Telebirr mobile money
- **Merchant Management**: API key management and usage tracking
- **Security Features**: Fraud prevention, merchant verification, and reference deduplication

## Hosting Considerations

Due to regional restrictions by the Telebirr system, hosting the `verify-telebirr` endpoint outside of Ethiopia may result in failed receipt verification. Specifically:

- Telebirr's receipt pages often block or timeout requests made from foreign IP addresses
- This results in errors such as `ERR_FAILED`, `403`, or DNS resolution failures

**Affected**: VPS or cloud servers located outside Ethiopia  
**Works Best**: Ethiopian-hosted servers or local development infrastructure

## Payment Methods

### CBE Bank Transfers

Verify Commercial Bank of Ethiopia transfers using reference numbers and account suffixes. LumePay extracts comprehensive transaction details including:

- Payer and receiver information
- Transaction amounts and dates
- Payment references and descriptions
- Account verification

### Telebirr Mobile Money

Process Telebirr mobile money payments with automatic receipt verification. Features include:

- Transaction status verification
- Amount and fee breakdown
- Receipt number tracking
- Payer identification

## API Endpoints

### Core Payment Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/intents` | POST | Create payment intent |
| `/intents/:id` | GET | Retrieve payment intent |
| `/intents/:id/confirm` | POST | Confirm payment with reference |

### Verification Services

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/verify-cbe` | POST | Verify CBE bank transfer |
| `/verify-telebirr` | POST | Verify Telebirr payment |
| `/verify-image` | POST | OCR-based receipt verification |

### Webhook Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks` | POST | Create webhook subscription |
| `/webhooks` | GET | List webhook subscriptions |
| `/webhooks/:id` | PUT | Update webhook subscription |
| `/webhooks/:id` | DELETE | Remove webhook subscription |

### Administrative

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/api-keys` | POST | Generate API keys |
| `/admin/stats` | GET | View usage statistics |
| `/health` | GET | System health check |

## Getting Started

### Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Mistral AI API key (for image verification)

### Deployment

LumePay is designed to be self-hosted. After deployment, you'll have your own payment gateway running on your infrastructure, accessible at your domain or localhost for development.

### Installation

```bash
# Clone the repository
git clone https://github.com/n3p-tun3/verifier-api-lumepay
cd verifier-api-lumepay

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npx prisma migrate dev

# Start development server
pnpm dev
```

### Environment Configuration

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/lumepay"

# API Configuration
PORT=3001
NODE_ENV=development

# External Services
MISTRAL_API_KEY=your_mistral_api_key

# Admin Access
ADMIN_SECRET=your_admin_secret_key
```

## Usage Examples

### Creating a Payment Intent

```bash
curl -X POST http://localhost:3001/intents \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "merchant": "your-business",
    "paymentMethodType": "CBE",
    "expectedReceiverAccount": "12345678",
    "expectedReceiverName": "Your Business Name"
  }'
```

### Confirming a Payment

```bash
curl -X POST http://localhost:3001/intents/INTENT_ID/confirm \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "reference": "FT2513001V2G"
  }'
```

### Setting Up Webhooks

```bash
curl -X POST http://localhost:3001/webhooks \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/webhooks",
    "events": ["payment_intent.confirmed", "payment_intent.failed"]
  }'
```

## Webhook Integration

LumePay provides real-time payment notifications through webhooks. Configure webhook endpoints to receive instant updates on:

- Payment intent creation
- Successful payment confirmations
- Failed payment attempts
- Payment expirations

### Webhook Security

All webhooks include HMAC-SHA256 signatures for verification. Implement signature validation in your webhook handlers:

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

## Security Features

### API Key Management

- Unique API keys per merchant
- Usage tracking and monitoring
- Automatic rate limiting
- Secure key generation

### Payment Verification

- Multi-layer verification system
- Merchant identity validation
- Amount matching verification
- Reference deduplication

### Data Protection

- Encrypted webhook secrets
- Secure database connections
- Audit logging for all operations
- Merchant data isolation

## Development

### Project Structure

```
src/
├── routes/           # API route handlers
├── services/         # Business logic services
├── middleware/       # Express middleware
├── utils/            # Utility functions
└── types/            # TypeScript type definitions
```

### Database Schema

LumePay uses Prisma ORM with PostgreSQL. Key models include:

- `PaymentIntent`: Payment intent management
- `WebhookSubscription`: Webhook configuration
- `ApiKey`: Merchant API key management
- `UsageLog`: Request tracking and analytics


## Deployment

### Production Setup

```bash
# Build the application
pnpm build

# Start production server
pnpm start

# Run database migrations
npx prisma migrate deploy
```

### Docker Deployment

```bash
# Build Docker image
docker build -t lumepay .

# Run container
docker run -p 3001:3001 --env-file .env lumepay
```

### Environment Variables

Ensure all required environment variables are set in production:

- `DATABASE_URL`: Production PostgreSQL connection
- `NODE_ENV=production`
- `ADMIN_SECRET`: Strong admin authentication key
- `MISTRAL_API_KEY`: Valid Mistral AI API key

## Monitoring and Analytics

### Built-in Monitoring

- Request logging with Winston
- Performance metrics tracking
- Error monitoring and alerting
- Webhook delivery status tracking

### Health Checks

- Database connectivity monitoring
- External service status checks
- System resource monitoring
- Automated alerting

## Contributing

We welcome contributions to LumePay. Please read our contributing guidelines and ensure all code follows our standards.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

### Code Standards

- TypeScript for type safety
- ESLint for code quality
- Prettier for formatting
- Comprehensive error handling
- Detailed logging

## License

LumePay is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

### Documentation

- [API Reference](README.md)
- [Integration Guides](README.md#usage-examples)
- [Webhook Documentation](WEBHOOK_README.md)

### Community

- [GitHub Issues](https://github.com/n3p-tun3/verifier-api-lumepay/issues)
- [Discussions](https://github.com/n3p-tun3/verifier-api-lumepay/discussions)

## Roadmap

### Upcoming Features

- Subscription management system
- Advanced analytics dashboard
- Enhanced fraud detection
- SDKs

## Acknowledgments

LumePay builds upon the foundation of [Leul Zenebe's open-source payment verification technology](https://github.com/Vixen878/verifier-api)

---

**LumePay** - Empowering businesses with modern payment solutions.