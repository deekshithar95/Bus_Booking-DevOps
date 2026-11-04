const request = require("supertest");
const bcrypt = require("bcryptjs");

jest.mock("../src/db", () => ({
    execute: jest.fn(),
    end: jest.fn()
}));

process.env.JWT_SECRET = "test-only-secret-for-jest";

const app = require("../src/app");
const pool = require("../src/db");

describe("User Service API Tests", () => {
    let passwordHash;

    beforeAll(async () => {
        passwordHash = await bcrypt.hash("Test@12345", 12);
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("GET /health should return healthy status", async () => {
        const response = await request(app).get("/health");

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("healthy");
    });

    test("POST /register should reject missing fields", async () => {
        const response = await request(app)
            .post("/register")
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Name, email and password are required");
    });

    test("POST /register should reject short passwords", async () => {
        const response = await request(app)
            .post("/register")
            .send({
                name: "Test User",
                email: "test@example.com",
                password: "short"
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Password must contain at least 8 characters");
    });

    test("POST /register should reject an existing email", async () => {
        pool.execute.mockResolvedValueOnce([
            [{ id: 1 }],
            []
        ]);

        const response = await request(app)
            .post("/register")
            .send({
                name: "Test User",
                email: "TEST@example.com",
                password: "Test@12345"
            });

        expect(response.status).toBe(409);
        expect(response.body.message).toBe("Email already registered");
    });

    test("POST /register should register a new user", async () => {
        pool.execute
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([{ insertId: 10 }, []]);

        const response = await request(app)
            .post("/register")
            .send({
                name: "Test User",
                email: "TEST@example.com",
                password: "Test@12345",
                phone: "9876543210"
            });

        expect(response.status).toBe(201);
        expect(response.body.message).toBe("User registered successfully");
        expect(response.body.user.id).toBe(10);
        expect(response.body.user.email).toBe("test@example.com");
    });

    test("POST /login should reject missing credentials", async () => {
        const response = await request(app)
            .post("/login")
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Email and password are required");
    });

    test("POST /login should reject an unknown user", async () => {
        pool.execute.mockResolvedValueOnce([[], []]);

        const response = await request(app)
            .post("/login")
            .send({
                email: "unknown@example.com",
                password: "Test@12345"
            });

        expect(response.status).toBe(401);
        expect(response.body.message)
            .toBe("Invalid email or password");
    });

    test("POST /login should return a JWT for valid credentials", async () => {
        pool.execute.mockResolvedValueOnce([
            [{
                id: 10,
                name: "Test User",
                email: "test@example.com",
                phone: "9876543210",
                password_hash: passwordHash
            }],
            []
        ]);

        const response = await request(app)
            .post("/login")
            .send({
                email: "test@example.com",
                password: "Test@12345"
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe("Login successful");
        expect(response.body.token).toBeDefined();
        expect(response.body.user.id).toBe(10);
    });

    test("GET /profile should reject requests without a token", async () => {
        const response = await request(app).get("/profile");

        expect(response.status).toBe(401);
        expect(response.body.message).toBe("Access token required");
    });

    test("GET /profile should return the authenticated user's profile", async () => {
        const jwt = require("jsonwebtoken");

        const token = jwt.sign(
            {
                userId: 10,
                email: "test@example.com"
            },
            process.env.JWT_SECRET
        );

        pool.execute.mockResolvedValueOnce([
            [{
                id: 10,
                name: "Test User",
                email: "test@example.com",
                phone: "9876543210",
                created_at: "2026-11-04T10:00:00.000Z"
            }],
            []
        ]);

        const response = await request(app)
            .get("/profile")
            .set("Authorization", `Bearer ${token}`);

        expect(response.status).toBe(200);
        expect(response.body.user.id).toBe(10);
        expect(response.body.user.email).toBe("test@example.com");
    });
});