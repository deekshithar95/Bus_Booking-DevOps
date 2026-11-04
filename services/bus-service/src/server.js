const app = require("./app");
const pool = require("./db");

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, () => {
    console.log(`Bus Service running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
    server.close(async () => {
        await pool.end();
        process.exit(0);
    });
});