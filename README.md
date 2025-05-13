# 📄 Payment Verification API

This API provides verification services for payment transactions made through **Commercial Bank of Ethiopia (CBE)** and **Telebirr** mobile payment platforms in Ethiopia.  
It allows applications to verify the authenticity and details of payment receipts by reference numbers or uploaded images.

> ⚠️ **Disclaimer**: This is **not an official API**. I am **not affiliated with Ethio Telecom, Telebirr, or Commercial Bank of Ethiopia (CBE)**. This tool is built for personal and developer utility purposes only and scrapes publicly available data.

---

## ✅ Features

### 🔷 CBE Payment Verification

- Verifies CBE bank transfers using reference number and account suffix
- Extracts key payment details:
  - Payer name and account
  - Receiver name and account
  - Transaction amount
  - Payment date and time
  - Reference number
  - Payment description/reason

### 🔶 Telebirr Payment Verification

- Verifies Telebirr mobile money transfers using a reference number
- Extracts key transaction details:
  - Payer name and Telebirr number
  - Credited party name and account
  - Transaction status
  - Receipt number
  - Payment date
  - Settled amount
  - Service fees and VAT
  - Total paid amount

### 🔷 Image-based Payment Verification

- Verifies payments by analyzing uploaded receipt images
- Uses **Mistral AI** to detect receipt type and extract transaction details
- Supports both **CBE** and **Telebirr** receipt screenshots

---

## 🌐 Hosting Limitations for `verify-telebirr`

Due to **regional restrictions** by the Telebirr system, hosting the `verify-telebirr` endpoint outside of Ethiopia (e.g., on a VPS like Hetzner or AWS) may result in failed receipt verification. Specifically:

- Telebirr’s receipt pages (`https://transactioninfo.ethiotelecom.et/receipt/[REFERENCE]`) often **block or timeout** requests made from foreign IP addresses.
- This results in errors such as `ERR_FAILED`, `403`, or DNS resolution failures.

### ❌ Affected:

- VPS or cloud servers located outside Ethiopia

### ✅ Works Best On:

- Ethiopian-hosted servers (e.g., Ethio Telecom web hosting, TeleCloud VPS)
- Developers self-hosting the code on infrastructure based in Ethiopia

#### 🛠 Proxy Support:

This project includes a secondary Telebirr verification relay hosted inside Ethiopia. When the primary `verify-telebirr` fetch fails on your foreign VPS, the server can **fallback to our proxy** to complete the verification.

For best results and full control, clone the repository and **self-host from inside Ethiopia**.

---

## ⚙️ Installation

```bash
# Clone the repository
git clone https://github.com/Vixen878/verifier-api

# Navigate to the project directory
cd verifier-api

# Install dependencies
pnpm install
```

---

## 🧪 Usage

### 🛠 Development

```bash
pnpm dev
```

### 🚀 Production Build

```bash
pnpm build
pnpm start
```

---

## 📡 API Endpoints

### ✅ CBE Verification

#### `POST /verify-cbe`

Verify a CBE payment using a reference number and account suffix.

**Request Body:**

```json
{
  "reference": "REFERENCE_NUMBER",
  "accountSuffix": "ACCOUNT_SUFFIX"
}
```

---

### ✅ Telebirr Verification

#### `POST /verify-telebirr`

Verify a Telebirr payment using a reference number.

**Request Body:**

```json
{
  "reference": "REFERENCE_NUMBER"
}
```

---

### ✅ Image Verification

#### `POST /verify-image`

Verify a payment by uploading an image of the receipt. This endpoint supports both CBE and Telebirr screenshots.

**Request Body:**
Multipart form-data with an image file.

- Optional Query Param: `?autoVerify=true`  
  When enabled, the system detects the receipt type and routes it to the correct verification flow automatically.
- **Note**: If the auto-detected receipt is from CBE, the request **must** include your `Suffix` (last 8 digits of your account).

---

### ✅ Health Check

#### `GET /health`

Check if the API is running properly.

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2023-06-15T12:34:56.789Z"
}
```

---

### ✅ API Information

#### `GET /`

Get information about the API and available endpoints.

**Response:**

```json
{
  "message": "Verifier API is running",
  "version": "1.0.0",
  "endpoints": ["/verify-cbe", "/verify-telebirr", "/verify-image"],
  "health": "/health",
  "documentation": "https://github.com/Vixen878/verifier-api"
}
```

---

## 🔐 Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
PORT=3001
NODE_ENV=development # or production
LOG_LEVEL=info       # or debug, error
MISTRAL_API_KEY=your_mistral_api_key # Required for image verification
```

You can get an API key for Mistral AI from [https://mistral.ai/](https://mistral.ai/)

---

## 📝 Logging

- Uses [`winston`](https://github.com/winstonjs/winston) for structured logging.
- Log files are stored under the `logs/` directory:
  - `logs/error.log` – error-level logs
  - `logs/combined.log` – all logs including debug/info
- `debug` logs are **only visible in development** mode (`NODE_ENV !== 'production'`).

To override log level manually:

```env
LOG_LEVEL=debug
```

---

## 🧰 Technologies Used

- Node.js with Express
- TypeScript
- Axios – HTTP requests
- Cheerio – HTML parsing
- Puppeteer – headless browser automation (used for CBE scraping)
- Winston – structured logging
- Mistral AI – OCR for image-based verification

---

## 📄 License

MIT License — see the [LICENSE](./LICENSE) file for details.

---

## 👤 Maintainer

**Leul Zenebe**  
Creofam LLC  
🌐 [creofam.com](https://creofam.com)  
🌐 [Personal Site](https://leulzenebe.pro)
