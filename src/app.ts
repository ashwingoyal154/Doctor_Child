import "express-async-errors";
import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import metricsRouter from "./routes/metrics";
import aiGuidanceRouter from "./routes/aiGuidance";
import consultationsRouter from "./routes/consultations";

const app = express();

app.use(cors());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/metrics", metricsRouter);
app.use("/api/ai-guidance", aiGuidanceRouter);
app.use("/api/consultations", consultationsRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message ?? "Internal server error",
  });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Doctor-Child backend listening on port ${PORT}`);
});

export default app;
