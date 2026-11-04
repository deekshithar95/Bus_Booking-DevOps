
process.env.JWT_SECRET = "booking-test-secret";

jest.mock("../src/db", () => ({
    execute: jest.fn(),
    getConnection: jest.fn(),
    end: jest.fn()
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../src/app");
const pool = require("../src/db");

const token = jwt.sign(
    { userId: 2 },
    process.env.JWT_SECRET
);

const authHeader = {
    Authorization: `Bearer ${token}`
};

let connection;

beforeEach(() => {
    jest.clearAllMocks();

    connection = {
        beginTransaction: jest.fn().mockResolvedValue(),
        execute: jest.fn(),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn()
    };

    pool.getConnection.mockResolvedValue(connection);
});

describe("Booking Service API Tests", () => {

    test("GET / should return booking service status", async () => {
        const response = await request(app).get("/");

        expect(response.status).toBe(200);
        expect(response.body.service).toBe("booking-service");
        expect(response.body.status).toBe("running");
    });

    test("GET /health should return healthy status", async () => {
        const response = await request(app).get("/health");

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("healthy");
    });

    test("GET /db/health should return successful database connection", async () => {
        pool.execute.mockResolvedValueOnce([
            [{ database_name: "busbooking" }]
        ]);

        const response = await request(app).get("/db/health");

        expect(response.status).toBe(200);
        expect(response.body.database).toBe("busbooking");
        expect(response.body.connection).toBe("successful");
    });

    test("POST / should reject booking without token", async () => {
        const response = await request(app)
            .post("/")
            .send({ bus_id: 1, seat_number: 1 });

        expect(response.status).toBe(401);
        expect(response.body.message).toBe("Access token required");
    });

    test("POST / should reject invalid token", async () => {
        const response = await request(app)
            .post("/")
            .set("Authorization", "Bearer invalid-token")
            .send({ bus_id: 1, seat_number: 1 });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe("Invalid or expired token");
    });

    test("POST / should reject missing booking details", async () => {
        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(
            "Valid bus_id and numeric seat_number are required"
        );
    });

    test("POST / should reject invalid bus ID", async () => {
        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: "abc", seat_number: 1 });

        expect(response.status).toBe(400);
    });

    test("POST / should reject non-numeric seat number", async () => {
        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: 1, seat_number: "A1" });

        expect(response.status).toBe(400);
    });

    test("POST / should return 404 when bus does not exist", async () => {
        connection.execute.mockResolvedValueOnce([[]]);

        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: 999, seat_number: 1 });

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Bus not found");
        expect(connection.rollback).toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalled();
    });

    test("POST / should reject seat number greater than total seats", async () => {
        connection.execute.mockResolvedValueOnce([
            [{
                id: 1,
                total_seats: 40,
                fare: 850,
                departure_time: "2099-01-15T20:00:00"
            }]
        ]);

        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: 1, seat_number: 41 });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(
            "Seat number must be between 1 and 40"
        );
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("POST / should reject booking for departed bus", async () => {
        connection.execute.mockResolvedValueOnce([
            [{
                id: 1,
                total_seats: 40,
                fare: 850,
                departure_time: "2000-01-01T20:00:00"
            }]
        ]);

        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: 1, seat_number: 1 });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe(
            "Cannot book a bus that has already departed"
        );
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("POST / should reject an already booked seat", async () => {
        connection.execute
            .mockResolvedValueOnce([
                [{
                    id: 1,
                    total_seats: 40,
                    fare: 850,
                    departure_time: "2099-01-15T20:00:00"
                }]
            ])
            .mockResolvedValueOnce([[{ id: 10 }]]);

        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: 1, seat_number: 1 });

        expect(response.status).toBe(409);
        expect(response.body.message).toBe("This seat is already booked");
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("POST / should create a booking successfully", async () => {
        connection.execute
            .mockResolvedValueOnce([
                [{
                    id: 1,
                    total_seats: 40,
                    fare: 850,
                    departure_time: "2099-01-15T20:00:00"
                }]
            ])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ insertId: 101 }]);

        const response = await request(app)
            .post("/")
            .set(authHeader)
            .send({ bus_id: 1, seat_number: 5 });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe("Booking created successfully");
        expect(response.body.booking.booking_id).toBe(101);
        expect(response.body.booking.user_id).toBe(2);
        expect(response.body.booking.bus_id).toBe(1);
        expect(response.body.booking.seat_number).toBe("5");
        expect(response.body.booking.status).toBe("CONFIRMED");

        expect(connection.commit).toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalled();
    });

    test("GET /my-bookings should return logged-in user's bookings", async () => {
        pool.execute.mockResolvedValueOnce([
            [{
                booking_id: 101,
                user_id: 2,
                bus_id: 1,
                seat_number: "5",
                booking_status: "CONFIRMED"
            }]
        ]);

        const response = await request(app)
            .get("/my-bookings")
            .set(authHeader);

        expect(response.status).toBe(200);
        expect(response.body.count).toBe(1);
        expect(response.body.bookings).toHaveLength(1);
    });

    test("GET /my-bookings should reject requests without token", async () => {
        const response = await request(app).get("/my-bookings");

        expect(response.status).toBe(401);
    });

    test("GET /:id should return booking details", async () => {
        pool.execute.mockResolvedValueOnce([
            [{
                booking_id: 101,
                user_id: 2,
                bus_id: 1,
                seat_number: "5",
                booking_status: "CONFIRMED"
            }]
        ]);

        const response = await request(app)
            .get("/101")
            .set(authHeader);

        expect(response.status).toBe(200);
        expect(response.body.booking.booking_id).toBe(101);
    });

    test("GET /:id should reject invalid booking ID", async () => {
        const response = await request(app)
            .get("/abc")
            .set(authHeader);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("Invalid booking ID");
    });

    test("GET /:id should return 404 when booking does not exist", async () => {
        pool.execute.mockResolvedValueOnce([[]]);

        const response = await request(app)
            .get("/999")
            .set(authHeader);

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Booking not found");
    });

    test("PUT /:id/cancel should cancel a confirmed booking", async () => {
        connection.execute
            .mockResolvedValueOnce([
                [{ id: 101, booking_status: "CONFIRMED" }]
            ])
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const response = await request(app)
            .put("/101/cancel")
            .set(authHeader);

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Booking cancelled successfully");
        expect(response.body.booking_id).toBe(101);
        expect(response.body.status).toBe("CANCELLED");

        expect(connection.commit).toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalled();
    });

    test("PUT /:id/cancel should reject an already cancelled booking", async () => {
        connection.execute.mockResolvedValueOnce([
            [{ id: 101, booking_status: "CANCELLED" }]
        ]);

        const response = await request(app)
            .put("/101/cancel")
            .set(authHeader);

        expect(response.status).toBe(409);
        expect(response.body.message).toBe("Booking is already cancelled");
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("PUT /:id/cancel should return 404 when booking does not exist", async () => {
        connection.execute.mockResolvedValueOnce([[]]);

        const response = await request(app)
            .put("/999/cancel")
            .set(authHeader);

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Booking not found");
        expect(connection.rollback).toHaveBeenCalled();
    });

    test("PUT /:id/cancel should reject invalid booking ID", async () => {
        const response = await request(app)
            .put("/abc/cancel")
            .set(authHeader);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("Invalid booking ID");
    });

    // Corrected: use a valid token so the dynamic /:id route
    // can finish and the 404 handler can return its response.
    test("GET /:id should reject non-numeric path as invalid booking ID", async () => {
    const response = await request(app)
        .get("/unknown-endpoint")
        .set(authHeader);

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Invalid booking ID");
});

});
