import express from "express";
import { config } from "./config.js";
import { logger } from "./logging/logger.js";
import healthRouter from "./routes/health.js";
import composeRouter from "./routes/compose.js";
import autonomyRouter from "./routes/autonomy.js";
import mcpHttpRouter from "./routes/mcpHttp.js";
import overseerRouter from "./routes/overseer.js";
import { recoverAutonomyRuntimeOnStartup } from "./autonomy/controller.js";
import { startAutonomyScheduler, stopAutonomyScheduler } from "./autonomy/scheduler.js";
import { startOverseerScheduler, stopOverseerScheduler } from "./overseer/scheduler.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(healthRouter);
app.use(composeRouter);
app.use(autonomyRouter);
app.use(mcpHttpRouter);
app.use(overseerRouter);

const server = app.listen(config.port, () => {
    logger.info(`AXIOM server listening on port ${config.port}`);
    recoverAutonomyRuntimeOnStartup();
    startOverseerScheduler();
    startAutonomyScheduler();
});

// Graceful shutdown
function shutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down`);
    stopAutonomyScheduler();
    stopOverseerScheduler();
    server.close(() => {
        logger.info("Server closed");
        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
