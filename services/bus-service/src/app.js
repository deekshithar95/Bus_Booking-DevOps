const express = require("express");
const pool = require("./db");

const app = express();

app.use(express.json());

// Home route
app.get("/info", (req, res) => {
    res.json({
        service: "bus-service",
        status: "running"
    });
});

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "healthy" });
});

// Database health check
app.get("/db/health", async (req, res) => {
    try {
        const [rows] = await pool.execute(
            "SELECT DATABASE() AS database_name"
        );

        res.json({
            service: "bus-service",
            database: rows[0].database_name,
            connection: "successful"
        });
    } catch (error) {
        console.error("Database health error:", error);
        res.status(500).json({
            message: "Database connection failed"
        });
    }
});

// Add a new bus
// Development endpoint: protect this with admin authentication before production.
app.post("/", async (req, res) => {
    try {
        const {
            bus_name,
            bus_number,
            source,
            destination,
            departure_time,
            arrival_time,
            total_seats,
            fare
        } = req.body;

        if (
            !bus_name || !bus_number || !source || !destination ||
            !departure_time || !arrival_time ||
            total_seats === undefined || fare === undefined
        ) {
            return res.status(400).json({
                message: "All bus details are required"
            });
        }

        const departure = new Date(departure_time);
        const arrival = new Date(arrival_time);

        if (
            Number.isNaN(departure.getTime()) ||
            Number.isNaN(arrival.getTime()) ||
            arrival <= departure
        ) {
            return res.status(400).json({
                message: "Invalid departure or arrival time"
            });
        }

        if (
            !Number.isInteger(Number(total_seats)) ||
            Number(total_seats) <= 0
        ) {
            return res.status(400).json({
                message: "Total seats must be a positive integer"
            });
        }

        if (!Number.isFinite(Number(fare)) || Number(fare) < 0) {
            return res.status(400).json({
                message: "Fare must be a non-negative number"
            });
        }

        if (
            source.trim().toLowerCase() ===
            destination.trim().toLowerCase()
        ) {
            return res.status(400).json({
                message: "Source and destination cannot be the same"
            });
        }

        const [result] = await pool.execute(
            `INSERT INTO buses
            (bus_name, bus_number, source, destination,
             departure_time, arrival_time, total_seats, fare)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                bus_name.trim(),
                bus_number.trim(),
                source.trim(),
                destination.trim(),
                departure_time,
                arrival_time,
                Number(total_seats),
                Number(fare)
            ]
        );

        res.status(201).json({
            message: "Bus added successfully",
            bus_id: result.insertId
        });
    } catch (error) {
        console.error("Add bus error:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "Bus number already exists"
            });
        }

        res.status(500).json({
            message: "Unable to add bus"
        });
    }
});

// Get all buses
app.get("/", async (req, res) => {
    try {
        const [buses] = await pool.execute(
            "SELECT * FROM buses ORDER BY departure_time"
        );

        res.json({
            count: buses.length,
            buses
        });
    } catch (error) {
        console.error("Get buses error:", error);
        res.status(500).json({
            message: "Unable to retrieve buses"
        });
    }
});

// Search buses by source, destination and optional date
app.get("/search", async (req, res) => {
    try {
        const { source, destination, date } = req.query;

        if (!source || !destination) {
            return res.status(400).json({
                message: "Source and destination are required"
            });
        }

        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({
                message: "Date must be in YYYY-MM-DD format"
            });
        }

        let query = `
            SELECT *
            FROM buses
            WHERE LOWER(source) = LOWER(?)
            AND LOWER(destination) = LOWER(?)
            AND departure_time >= NOW()
        `;

        const params = [source.trim(), destination.trim()];

        if (date) {
            query += " AND DATE(departure_time) = ?";
            params.push(date);
        }

        query += " ORDER BY departure_time";

        const [buses] = await pool.execute(query, params);

        res.json({
            count: buses.length,
            buses
        });
    } catch (error) {
        console.error("Search buses error:", error);
        res.status(500).json({
            message: "Bus search failed"
        });
    }
});

// Get bus by ID
app.get("/:id", async (req, res) => {
    try {
        const busId = Number(req.params.id);

        if (!Number.isInteger(busId) || busId <= 0) {
            return res.status(400).json({
                message: "Invalid bus ID"
            });
        }

        const [buses] = await pool.execute(
            "SELECT * FROM buses WHERE id = ?",
            [busId]
        );

        if (buses.length === 0) {
            return res.status(404).json({
                message: "Bus not found"
            });
        }

        res.json({ bus: buses[0] });
    } catch (error) {
        console.error("Get bus error:", error);
        res.status(500).json({
            message: "Unable to retrieve bus"
        });
    }
});

module.exports = app;