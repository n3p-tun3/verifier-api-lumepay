import axios, { AxiosError } from "axios";
import * as cheerio from "cheerio";
import logger from '../utils/logger';

export interface TelebirrReceipt {
    payerName: string;
    payerTelebirrNo: string;
    creditedPartyName: string;
    creditedPartyAccountNo: string;
    transactionStatus: string;
    receiptNo: string;
    paymentDate: string;
    settledAmount: string;
    serviceFeeVAT: string;
    totalPaidAmount: string;
}

export async function verifyTelebirr(reference: string): Promise<TelebirrReceipt | null> {
    const url = `https://transactioninfo.ethiotelecom.et/receipt/${reference}`;

    try {
        logger.info(`Starting Telebirr verification for reference: ${reference}`);
        const response = await axios.get(url);
        logger.debug(`Received response from Telebirr API with status: ${response.status}`);
        
        const $ = cheerio.load(response.data);
        
        // Log HTML content in debug mode to help diagnose scraping issues
        logger.debug(`HTML content length: ${response.data.length} bytes`);
        if (response.data.length < 100) {
            logger.warn(`Suspiciously short HTML response: ${response.data}`);
        }
        
        const getText = (selector: string): string =>
            $(selector).next().text().trim();

        const getPaymentDate = (): string =>
            $('.receipttableTd').filter((_, el) => $(el).text().includes("-202")).first().text().trim();

        const getSettledAmount = (): string => {
            // fallback: find by partial match of 'Birr'
            const candidate = $('td')
                .filter((_, el) => {
                    const text = $(el).text();
                    return text.includes("Birr") && Boolean(text.trim().match(/^\d+(\.\d{1,2})? Birr$/));
                })
                .last()
                .text()
                .trim();
            return candidate || "N/A";
        };

        const extractedData: TelebirrReceipt = {
            payerName: getText('td:contains("የከፋይ ስም/Payer Name")'),
            payerTelebirrNo: getText('td:contains("የከፋይ ቴሌብር ቁ./Payer telebirr no.")'),
            creditedPartyName: getText('td:contains("የገንዘብ ተቀባይ ስም/Credited Party name")'),
            creditedPartyAccountNo: getText('td:contains("የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no")'),
            transactionStatus: getText('td:contains("የክፍያው ሁኔታ/transaction status")'),
            receiptNo: $('td.receipttableTd.receipttableTd2')
                .eq(1) // second match: the value, not the label
                .text()
                .trim(),
            paymentDate: getPaymentDate(),
            settledAmount: getSettledAmount(),
            serviceFeeVAT: getText('td:contains("የአገልግሎት ክፍያ ተ.እ.ታ/Service fee VAT")'),
            totalPaidAmount: getText('td:contains("ጠቅላላ የተከፈለ/Total Paid Amount")')
        };

        logger.debug("Extracted data:", extractedData);

        logger.info(`Successfully extracted Telebirr data for reference: ${reference}`, {
            receiptNo: extractedData.receiptNo,
            payerName: extractedData.payerName,
            transactionStatus: extractedData.transactionStatus
        });
        
        return extractedData;
    } catch (error) {
        // Enhanced error logging with request details
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        // Check if it's an Axios error to safely access response properties
        const axiosError = error as AxiosError;
        const responseDetails = axiosError.response ? {
            status: axiosError.response.status,
            statusText: axiosError.response.statusText,
            responseData: axiosError.response.data
        } : {};
        
        logger.error(`Error verifying Telebirr receipt for reference ${reference}:`, {
            error: errorMessage,
            stack: errorStack,
            url,
            ...responseDetails
        });
        
        return null;
    }
}
