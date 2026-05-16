/**
 * Core-only entrypoint: compose pipeline + health.
 *
 * No autonomy scheduler, no overseer scheduler, no MCP surfaces.
 * Use this during active composition R&D to keep the runtime focused.
 *
 * For the full ops layer (autonomy, overseer, MCP): use src/index.ts.
 */
import express from "express";
import { config } from "./config.js";
import { logger } from "./logging/logger.js";
import healthRouter from "./routes/health.js";
import composeRouter from "./routes/compose.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(healthRouter);
app.use(composeRouter);

const server = app.listen(config.port, () => {
    logger.info(`AXIOM core server listening on port ${config.port}`);
    logger.info("Core-only mode: compose pipeline active, ops layer disabled");
});

function shutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down`);
    server.close(() => {
        logger.info("Server closed");
        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
