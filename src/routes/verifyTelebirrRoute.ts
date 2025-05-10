import { Router, Request, Response } from 'express';
import { verifyTelebirr } from '../services/verifyTelebirr';

const router = Router();

interface VerifyTelebirrRequestBody {
    reference: string;
}

router.post<{}, {}, VerifyTelebirrRequestBody>(
    '/',
    async (req: Request<{}, {}, VerifyTelebirrRequestBody>, res: Response): Promise<void> => {
        const { reference } = req.body;

        if (!reference) {
            res.status(400).json({ success: false, error: 'Missing reference.' });
            return;
        }

        try {
            const result = await verifyTelebirr(reference);
            res.json(result);
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: 'Server error verifying Telebirr receipt.' });
        }
    }
);

export default router;
