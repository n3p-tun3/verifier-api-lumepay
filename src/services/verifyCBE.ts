import puppeteer from 'puppeteer';
import axios, { AxiosResponse } from 'axios';
import pdf from 'pdf-parse';
import https from 'https';
import logger from '../utils/logger';

export interface VerifyResult {
    success: boolean;
    payer?: string;
    payerAccount?: string;
    receiver?: string;
    receiverAccount?: string;
    amount?: number;
    date?: Date;
    reference?: string;
    reason?: string | null;
    error?: string;
}

// Optional: Normalize names to title case
function titleCase(str: string): string {
    return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}

export async function verifyCBE(
    reference: string,
    accountSuffix: string
): Promise<VerifyResult> {
    const url = `https://apps.cbe.com.et:100/?id=${reference}${accountSuffix}`;
    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    let detectedPdfUrl: string | null = null;

    page.on('response', async (response) => {
        try {
            const resUrl = response.url();
            const status = response.status();
            const contentType = response.headers()['content-type'];

            logger.debug(`📡 [${status}] ${resUrl} ${contentType || ''}`);

            if (contentType?.includes('pdf')) {
                logger.info('🧾 Possible PDF found:', resUrl);
                detectedPdfUrl = resUrl;
            }
        } catch (err) {
            logger.error('❌ Error logging response:', err);
        }
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await new Promise(resolve => setTimeout(resolve, 3000)); // allow all network requests

        await browser.close();

        if (!detectedPdfUrl) {
            return { success: false, error: 'No PDF file was requested by the page.' };
        }

        const pdfResponse: AxiosResponse<ArrayBuffer> = await axios.get(detectedPdfUrl, {
            responseType: 'arraybuffer',
            httpsAgent
        });

        const parsed = await pdf(Buffer.from(pdfResponse.data));
        logger.debug('🧾 Raw PDF text:\n', parsed.text);

        const rawText = parsed.text.replace(/\s+/g, ' ').trim();

        // More flexible name and account patterns
        let payerName = rawText.match(/Payer\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim();
        let receiverName = rawText.match(/Receiver\s*:?\s*(.*?)\s+Account/i)?.[1]?.trim();

        // Match both masked account numbers (CBE or Telebirr format)
        const accountMatches = [...rawText.matchAll(/Account\s*:?\s*([A-Z0-9]?\*{4}\d{4})/gi)];
        const payerAccount = accountMatches?.[0]?.[1];
        const receiverAccount = accountMatches?.[1]?.[1];

        const reason = rawText.match(/Reason\s*\/\s*Type of service\s*:?\s*(.*?)\s+Transferred Amount/i)?.[1]?.trim();
        const amountText = rawText.match(/Transferred Amount\s*:?\s*([\d,]+\.\d{2})\s*ETB/i)?.[1];
        const referenceMatch = rawText.match(/Reference No\.?\s*\(VAT Invoice No\)\s*:?\s*([A-Z0-9]+)/i)?.[1]?.trim();
        const dateRaw = rawText.match(/Payment Date & Time\s*:?\s*([\d\/,: ]+[APM]{2})/i)?.[1]?.trim();

        const amount = amountText ? parseFloat(amountText.replace(/,/g, '')) : undefined;
        const date = dateRaw ? new Date(dateRaw) : undefined;

        // Optional title-case normalization
        payerName = payerName ? titleCase(payerName) : undefined;
        receiverName = receiverName ? titleCase(receiverName) : undefined;

        logger.debug('✅ payerName:', payerName);
        logger.debug('✅ payerAccount:', payerAccount);
        logger.debug('✅ receiverName:', receiverName);
        logger.debug('✅ receiverAccount:', receiverAccount);
        logger.debug('✅ amount:', amount);
        logger.debug('✅ reference:', referenceMatch);
        logger.debug('✅ date:', date);

        if (payerName && payerAccount && receiverName && receiverAccount && amount && date && referenceMatch) {
            const formattedDate = date.toDateString();
            const message = `
✅ Transaction Verified! ✅

Payer:
   Name: ${payerName}
   Account: ${payerAccount}
   Reason: ${reason || "N/A"}

Receiver:
   Name: ${receiverName}
   Account: ${receiverAccount}

Amount: ${amount.toLocaleString()} ETB

Date: ${formattedDate}
Reference: ${referenceMatch}
`.trim();

            logger.info(message);
            return {
                success: true,
                payer: payerName,
                payerAccount,
                receiver: receiverName,
                receiverAccount,
                amount,
                date,
                reference: referenceMatch,
                reason: reason || null
            };
        }

        logger.warn("⚠️ Could not extract all required fields", {
            payerName,
            payerAccount,
            receiverName,
            receiverAccount,
            amount,
            referenceMatch,
            date
        });

        return {
            success: false,
            error: 'Could not extract all required fields from the PDF.'
        };
    } catch (err: any) {
        await browser.close();
        return {
            success: false,
            error: `Error fetching or parsing PDF: ${err.message || 'unknown'}`
        };
    }
}
