import { Mistral } from "@mistralai/mistralai";
import fs from "fs";
import { Request, Response } from "express";
import multer from "multer";
import logger from "../utils/logger";
import dotenv from 'dotenv';

dotenv.config();

const upload = multer({ dest: "uploads/" });

const client = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY!,
});

export const verifyImageHandler = [
    upload.single("file"),

    async (req: Request, res: Response): Promise<void> => {
        try {
            if (!req.file) {
                logger.warn("No file uploaded in /verify-image");
                res.status(400).json({ error: "No file uploaded" });
                return;
            }

            const filePath = req.file.path;
            const imageBuffer = fs.readFileSync(filePath);
            const base64Image = imageBuffer.toString("base64");

            const prompt = `Extract only the transaction number if it's a Telebirr receipt, or the transaction ID if it's a CBE receipt. Also include the type as either 'telebirr' or 'cbe'. Return result as JSON.`;

            logger.info("Sending image to Mistral Vision...");

            const chatResponse = await client.chat.complete({
                model: "pixtral-12b",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                imageUrl: `data:image/jpeg;base64,${base64Image}`,
                            },
                        ],
                    },
                ],
                responseFormat: { type: "json_object" },
            });

            const messageContent = chatResponse.choices?.[0]?.message?.content;
            logger.debug("Mistral raw content:", { messageContent });

            if (!messageContent || typeof messageContent !== "string") {
                logger.error("Mistral response missing or invalid", { messageContent });
                res.status(500).json({ error: "Unexpected response format from Mistral" });
                return;
            }

            let result;
            try {
                result = JSON.parse(messageContent);
                logger.info("Parsed OCR result:", result);
            } catch (jsonErr) {
                logger.error("Failed to parse Mistral result as JSON", { jsonErr, messageContent });
                res.status(500).json({ error: "Invalid JSON from Mistral response" });
                return;
            }

            if (result.type === "telebirr" && result.transaction_number) {
                res.json({
                    forward_to: "/verify-telebirr",
                    payload: { reference: result.transaction_number },
                });
                return;
            }

            if (result.type === "cbe" && result.transaction_id) {
                res.json({
                    forward_to: "/verify-cbe",
                    payload: {
                        reference: result.transaction_id,
                        accountSuffix: "required_from_user",
                    },
                });
                return;
            }

            logger.warn("Could not determine receipt type or transaction ID", { result });
            res.status(422).json({ error: "Could not identify receipt type or extract ID." });
        } catch (err) {
            logger.error(`Unexpected error in /verify-image: ${err instanceof Error ? err.message : String(err)}`, { stack: err instanceof Error ? err.stack : undefined });
            res.status(500).json({ error: "Something went wrong processing the image." });
        } finally {
            if (req.file?.path) {
                fs.unlinkSync(req.file.path); // Cleanup uploaded file
                logger.debug("Temp file deleted:", { path: req.file.path });
            }
        }
    },
];
