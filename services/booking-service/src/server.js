const app = require("./app");
const pool = require("./db");

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, () => {
    console.log(`Booking Service running on port ${PORT}`);
});

process.on("SIGTERM", () => {
    console.log("Booking Service shutting down...");

    server.close(async () => {
        await pool.end();
        console.log("Booking Service stopped");
        process.exit(0);
    });
});