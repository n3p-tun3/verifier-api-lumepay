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
 * Parses Telebirr receipt data from JSON response
 * @param jsonData The JSON data from the proxy endpoint
 * @returns Extracted Telebirr receipt data
 */
function parseTelebirrJson(jsonData: any): TelebirrReceipt | null {
    try {
        // Check if the response has the expected structure
        if (!jsonData || !jsonData.success || !jsonData.data) {
            logger.warn("Invalid JSON structure from proxy endpoint", { jsonData });
            return null;
        }

        const data = jsonData.data;
        
        return {
            payerName: data.payerName || "",
            payerTelebirrNo: data.payerTelebirrNo || "",
            creditedPartyName: data.creditedPartyName || "",
            creditedPartyAccountNo: data.creditedPartyAccountNo || "",
            transactionStatus: data.transactionStatus || "",
            receiptNo: data.receiptNo || "",
            paymentDate: data.paymentDate || "",
            settledAmount: data.settledAmount || "N/A",
            serviceFeeVAT: data.serviceFeeVAT || "",
            totalPaidAmount: data.totalPaidAmount || ""
        };
    } catch (error) {
        logger.error("Error parsing JSON from proxy endpoint", { error, jsonData });
        return null;
    }
}

/**
 * Fetches and processes Telebirr receipt data from the primary source (HTML)
 * @param reference The Telebirr reference number
 * @param baseUrl The base URL to fetch the receipt from
 * @returns The scraped receipt data or null if failed
 */
async function fetchFromPrimarySource(reference: string, baseUrl: string): Promise<TelebirrReceipt | null> {
    const url = `${baseUrl}${reference}`;
    
    try {
        logger.info(`Attempting to fetch Telebirr receipt from primary source: ${url}`);
        const response = await axios.get(url, { timeout: 15000 }); // 15 second timeout
        logger.debug(`Received response with status: ${response.status}`);
        
        const extractedData = scrapeTelebirrReceipt(response.data);
        
        logger.debug("Extracted data from HTML:", extractedData);
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
        
        logger.error(`Error fetching Telebirr receipt from primary source ${url}:`, {
            error: errorMessage,
            stack: errorStack,
            ...responseDetails
        });
        
        return null;
    }
}

/**
 * Fetches and processes Telebirr receipt data from the fallback proxy (JSON)
 * @param reference The Telebirr reference number
 * @param proxyUrl The proxy URL to fetch the receipt from
 * @returns The parsed receipt data or null if failed
 */
async function fetchFromProxySource(reference: string, proxyUrl: string): Promise<TelebirrReceipt | null> {
    const url = `${proxyUrl}${reference}`;
    
    try {
        logger.info(`Attempting to fetch Telebirr receipt from proxy: ${url}`);
        const response = await axios.get(url, { 
            timeout: 15000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'VerifierAPI/1.0'
            }
        });
        
        logger.debug(`Received proxy response with status: ${response.status}`);
        
        // Check if response is JSON
        let data = response.data;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                logger.warn("Proxy response is not valid JSON, attempting to scrape as HTML");
                // If it's not JSON, try to scrape it as HTML
                return scrapeTelebirrReceipt(response.data);
            }
        }
        
        const extractedData = parseTelebirrJson(data);
        if (!extractedData) {
            logger.warn("Failed to parse JSON from proxy, attempting to scrape as HTML");
            // If JSON parsing fails, try to scrape it as HTML
            return scrapeTelebirrReceipt(response.data);
        }
        
        logger.debug("Extracted data from JSON:", extractedData);
        logger.info(`Successfully extracted Telebirr data from proxy for reference: ${reference}`, {
            receiptNo: extractedData.receiptNo,
            payerName: extractedData.payerName,
            transactionStatus: extractedData.transactionStatus
        });
        
        return extractedData;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        const axiosError = error as AxiosError;
        const responseDetails = axiosError.response ? {
            status: axiosError.response.status,
            statusText: axiosError.response.statusText,
            responseData: axiosError.response.data
        } : {};
        
        logger.error(`Error fetching Telebirr receipt from proxy ${url}:`, {
            error: errorMessage,
            stack: errorStack,
            ...responseDetails
        });
        
        return null;
    }
}

export async function verifyTelebirr(reference: string): Promise<TelebirrReceipt | null> {
    const primaryUrl = "https://transactioninfo.ethiotelecom.et/receipt/";
    const fallbackUrl = "https://leul.et/verify.php?reference=";

    const skipPrimary = process.env.SKIP_PRIMARY_VERIFICATION === "true";

    if (!skipPrimary) {
        const primaryResult = await fetchFromPrimarySource(reference, primaryUrl);
        if (primaryResult) return primaryResult;
        logger.warn(`Primary Telebirr verification failed for reference: ${reference}. Trying fallback proxy...`);
    } else {
        logger.info(`Skipping primary verifier due to SKIP_PRIMARY_VERIFICATION=true`);
    }

    const fallbackResult = await fetchFromProxySource(reference, fallbackUrl);
    if (fallbackResult) {
        logger.info(`Successfully verified Telebirr receipt using fallback proxy for reference: ${reference}`);
        return fallbackResult;
    }

    logger.error(`Both primary and fallback Telebirr verification failed for reference: ${reference}`);
    return null;
}
