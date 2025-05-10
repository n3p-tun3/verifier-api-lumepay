import axios from "axios";
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
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);

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

        return extractedData;
    } catch (error) {
        logger.error("Error verifying Telebirr receipt:", error instanceof Error ? error.message : "Unknown error");
        return null;
    }
}
