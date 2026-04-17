import express from "express";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import healthRouter from "../routes/health.js";
import mcpHttpRouter from "../routes/mcpHttp.js";
import { recoverAutonomyRuntimeOnStartup } from "../autonomy/controller.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(healthRouter);
app.use(mcpHttpRouter);

const server = app.listen(config.mcpHttpPort, () => {
    logger.info(`AXIOM MCP HTTP server listening on port ${config.mcpHttpPort}`);
    recoverAutonomyRuntimeOnStartup();
});

function shutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down MCP HTTP server`);
    server.close(() => {
        logger.info("AXIOM MCP HTTP server closed");
        process.exit(0);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));