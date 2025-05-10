import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import verifyRouter from './routes/verify';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ✅ Attach router to this path
app.use('/verify-payment', verifyRouter);

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
