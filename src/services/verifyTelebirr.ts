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

/**
 * Scrapes Telebirr receipt data from HTML content
 * @param html The HTML content to scrape
 * @returns Extracted Telebirr receipt data
 */
function scrapeTelebirrReceipt(html: string): TelebirrReceipt {
    const $ = cheerio.load(html);
    
    // Log HTML content in debug mode to help diagnose scraping issues
    logger.debug(`HTML content length: ${html.length} bytes`);
    if (html.length < 100) {
        logger.warn(`Suspiciously short HTML response: ${html}`);
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

    return {
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
}

/**
 * Fetches and scrapes Telebirr receipt data from a given URL
 * @param reference The Telebirr reference number
 * @param baseUrl The base URL to fetch the receipt from
 * @returns The scraped receipt data or null if failed
 */
async function fetchAndScrapeTelebirr(reference: string, baseUrl: string): Promise<TelebirrReceipt | null> {
    const url = `${baseUrl}${reference}`;
    
    try {
        logger.info(`Attempting to fetch Telebirr receipt from: ${url}`);
        const response = await axios.get(url, { timeout: 15000 }); // 15 second timeout
        logger.debug(`Received response with status: ${response.status}`);
        
        const extractedData = scrapeTelebirrReceipt(response.data);
        
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
        
        logger.error(`Error fetching Telebirr receipt from ${url}:`, {
            error: errorMessage,
            stack: errorStack,
            ...responseDetails
        });
        
        return null;
    }
}

export async function verifyTelebirr(reference: string): Promise<TelebirrReceipt | null> {
    // Primary source - direct from Ethio Telecom
    const primaryUrl = "https://transactioninfo.ethiotelecom.et/receipt/";
    // Fallback source - proxy hosted in Ethiopia
    const fallbackUrl = "https://leul.et/verify.php?reference=";
    
    // Try primary source first
    const primaryResult = await fetchAndScrapeTelebirr(reference, primaryUrl);
    if (primaryResult) {
        return primaryResult;
    }
    
    // If primary source fails, try fallback
    logger.warn(`Primary Telebirr verification failed for reference: ${reference}. Trying fallback proxy...`);
    const fallbackResult = await fetchAndScrapeTelebirr(reference, fallbackUrl);
    
    if (fallbackResult) {
        logger.info(`Successfully verified Telebirr receipt using fallback proxy for reference: ${reference}`);
        return fallbackResult;
    }
    
    // Both primary and fallback failed
    logger.error(`Both primary and fallback Telebirr verification failed for reference: ${reference}`);
    return null;
}
