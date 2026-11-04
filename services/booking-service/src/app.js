
const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();

const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());

// Validate environment variables
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables");
}

// ==========================================
// JWT AUTHENTICATION MIDDLEWARE
// ==========================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Access token required"
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        req.user = jwt.verify(token, JWT_SECRET);

        if (!req.user.userId) {
            return res.status(403).json({
                message: "Invalid token payload"
            });
        }

        next();

    } catch (error) {
        return res.status(403).json({
            message: "Invalid or expired token"
        });
    }
}

// ==========================================
// HOME API
// ==========================================

app.get("/", (req, res) => {
    res.status(200).json({
        service: "booking-service",
        status: "running",
        message: "Welcome to BusBooking Booking Service"
    });
});

// ==========================================
// HEALTH CHECK API
// ==========================================

app.get("/health", (req, res) => {
    res.status(200).json({
        service: "booking-service",
        status: "healthy"
    });
});

// ==========================================
// DATABASE HEALTH CHECK API
// ==========================================

app.get("/db/health", async (req, res) => {
    try {
        const [rows] = await pool.execute(
            "SELECT DATABASE() AS database_name"
        );

        res.status(200).json({
            service: "booking-service",
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

// ==========================================
// CREATE BOOKING API
// POST /
// ==========================================

app.post("/", authenticateToken, async (req, res) => {
    let connection;

    try {
        const { bus_id, seat_number } = req.body;

        const userId = req.user.userId;
        const busId = Number(bus_id);
        const seatNumber = String(seat_number ?? "").trim();

        // Validate input
        if (
            !Number.isInteger(busId) ||
            busId <= 0 ||
            !/^\d+$/.test(seatNumber)
        ) {
            return res.status(400).json({
                message: "Valid bus_id and numeric seat_number are required"
            });
        }

        connection = await pool.getConnection();

        await connection.beginTransaction();

        // Check bus and lock its row
        const [buses] = await connection.execute(
            `SELECT id, total_seats, fare, departure_time
             FROM buses
             WHERE id = ?
             FOR UPDATE`,
            [busId]
        );

        if (buses.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                message: "Bus not found"
            });
        }

        const bus = buses[0];
        const seatNumberValue = Number(seatNumber);

        // Validate seat number
        if (
            seatNumberValue < 1 ||
            seatNumberValue > bus.total_seats
        ) {
            await connection.rollback();

            return res.status(400).json({
                message: `Seat number must be between 1 and ${bus.total_seats}`
            });
        }

        // Check departure time
        if (new Date(bus.departure_time) <= new Date()) {
            await connection.rollback();

            return res.status(400).json({
                message: "Cannot book a bus that has already departed"
            });
        }

        // Check whether seat is already booked
        const [existingBookings] = await connection.execute(
            `SELECT id
             FROM bookings
             WHERE bus_id = ?
             AND seat_number = ?
             AND booking_status = 'CONFIRMED'`,
            [busId, seatNumber]
        );

        if (existingBookings.length > 0) {
            await connection.rollback();

            return res.status(409).json({
                message: "This seat is already booked"
            });
        }

        // Insert booking
        const [result] = await connection.execute(
            `INSERT INTO bookings
             (user_id, bus_id, seat_number, booking_status)
             VALUES (?, ?, ?, 'CONFIRMED')`,
            [userId, busId, seatNumber]
        );

        await connection.commit();

        res.status(201).json({
            message: "Booking created successfully",

            booking: {
                booking_id: result.insertId,
                user_id: userId,
                bus_id: busId,
                seat_number: seatNumber,
                fare: bus.fare,
                status: "CONFIRMED"
            }
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Create booking error:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "This seat is already booked"
            });
        }

        res.status(500).json({
            message: "Unable to create booking"
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ==========================================
// GET ALL BOOKINGS OF LOGGED-IN USER
// GET /my-bookings
// ==========================================

app.get("/my-bookings", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const [bookings] = await pool.execute(
            `SELECT
                bk.id AS booking_id,
                bk.user_id,
                bk.bus_id,
                bk.seat_number,
                bk.booking_status,
                bk.booked_at,
                b.bus_name,
                b.bus_number,
                b.source,
                b.destination,
                b.departure_time,
                b.arrival_time,
                b.fare
             FROM bookings bk
             INNER JOIN buses b
             ON bk.bus_id = b.id
             WHERE bk.user_id = ?
             ORDER BY bk.booked_at DESC`,
            [userId]
        );

        res.status(200).json({
            count: bookings.length,
            bookings
        });

    } catch (error) {
        console.error("Get bookings error:", error);

        res.status(500).json({
            message: "Unable to retrieve bookings"
        });
    }
});

// ==========================================
// GET BOOKING BY ID
// GET /:id
// ==========================================

app.get("/:id", authenticateToken, async (req, res) => {
    try {
        const bookingId = Number(req.params.id);
        const userId = req.user.userId;

        if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0
        ) {
            return res.status(400).json({
                message: "Invalid booking ID"
            });
        }

        const [bookings] = await pool.execute(
            `SELECT
                bk.id AS booking_id,
                bk.user_id,
                bk.bus_id,
                bk.seat_number,
                bk.booking_status,
                bk.booked_at,
                b.bus_name,
                b.bus_number,
                b.source,
                b.destination,
                b.departure_time,
                b.arrival_time,
                b.fare
             FROM bookings bk
             INNER JOIN buses b
             ON bk.bus_id = b.id
             WHERE bk.id = ?
             AND bk.user_id = ?`,
            [bookingId, userId]
        );

        if (bookings.length === 0) {
            return res.status(404).json({
                message: "Booking not found"
            });
        }

        res.status(200).json({
            booking: bookings[0]
        });

    } catch (error) {
        console.error("Get booking error:", error);

        res.status(500).json({
            message: "Unable to retrieve booking"
        });
    }
});

// ==========================================
// CANCEL BOOKING API
// PUT /:id/cancel
// ==========================================

app.put("/:id/cancel", authenticateToken, async (req, res) => {
    let connection;

    try {
        const bookingId = Number(req.params.id);
        const userId = req.user.userId;

        if (
            !Number.isInteger(bookingId) ||
            bookingId <= 0
        ) {
            return res.status(400).json({
                message: "Invalid booking ID"
            });
        }

        connection = await pool.getConnection();

        await connection.beginTransaction();

        // Lock booking record
        const [bookings] = await connection.execute(
            `SELECT id, booking_status
             FROM bookings
             WHERE id = ?
             AND user_id = ?
             FOR UPDATE`,
            [bookingId, userId]
        );

        if (bookings.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                message: "Booking not found"
            });
        }

        if (bookings[0].booking_status === "CANCELLED") {
            await connection.rollback();

            return res.status(409).json({
                message: "Booking is already cancelled"
            });
        }

        // Update booking status
        await connection.execute(
            `UPDATE bookings
             SET booking_status = 'CANCELLED'
             WHERE id = ? AND user_id = ?`,
            [bookingId, userId]
        );

        await connection.commit();

        res.status(200).json({
            message: "Booking cancelled successfully",
            booking_id: bookingId,
            status: "CANCELLED"
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Cancel booking error:", error);

        res.status(500).json({
            message: "Unable to cancel booking"
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// ==========================================
// 404 HANDLER
// ==========================================

app.use((req, res) => {
    res.status(404).json({
        message: "API endpoint not found"
    });
});
module.exports = app;
