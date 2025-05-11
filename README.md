
# 📄 Payment Verification API

This API provides verification services for payment transactions made through **Commercial Bank of Ethiopia (CBE)** and **Telebirr** mobile payment platforms in Ethiopia.  
It allows applications to verify the authenticity and details of payment receipts by reference numbers.

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

---

## ⚙️ Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/verifier-api.git

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

---

## 📄 License

MIT License — see the [LICENSE](./LICENSE) file for details.

---

## 👤 Maintainer

**Leul Zenebe**  
Creofam LLC  
🌐 [creofam.com](https://creofam.com)
🌐 [Personal Site](https://leulzenebe.pro)
