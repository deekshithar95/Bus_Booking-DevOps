const request = require("supertest");

jest.mock("../src/db", () => ({
    execute: jest.fn(),
    end: jest.fn()
}));

const app = require("../src/app");
const pool = require("../src/db");

describe("Bus Service API Tests", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const validBus = {
        bus_name: "Express Travels",
        bus_number: "KA01AB1234",
        source: "Bangalore",
        destination: "Hyderabad",
        departure_time: "2027-01-15T20:00:00",
        arrival_time: "2027-01-16T06:00:00",
        total_seats: 40,
        fare: 850
    };

    test("GET /health should return healthy status", async () => {
        const response = await request(app).get("/health");

        expect(response.status).toBe(200);
        expect(response.body.status).toBe("healthy");
    });

    test("GET /info should return bus service information", async () => {
        const response = await request(app).get("/info");

        expect(response.status).toBe(200);
        expect(response.body.service).toBe("bus-service");
        expect(response.body.status).toBe("running");
    });

    test("POST / should reject missing bus details", async () => {
        const response = await request(app)
            .post("/")
            .send({});

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("All bus details are required");
    });

    test("POST / should reject invalid departure and arrival times", async () => {
        const response = await request(app)
            .post("/")
            .send({
                ...validBus,
                departure_time: "2027-01-16T06:00:00",
                arrival_time: "2027-01-15T20:00:00"
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Invalid departure or arrival time");
    });

    test("POST / should reject invalid seat count", async () => {
        const response = await request(app)
            .post("/")
            .send({
                ...validBus,
                total_seats: -5
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Total seats must be a positive integer");
    });

    test("POST / should reject negative fare", async () => {
        const response = await request(app)
            .post("/")
            .send({
                ...validBus,
                fare: -100
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Fare must be a non-negative number");
    });

    test("POST / should reject identical source and destination", async () => {
        const response = await request(app)
            .post("/")
            .send({
                ...validBus,
                source: "Bangalore",
                destination: "bangalore"
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Source and destination cannot be the same");
    });

    test("POST / should add a new bus", async () => {
        pool.execute.mockResolvedValueOnce([
            { insertId: 1 },
            []
        ]);

        const response = await request(app)
            .post("/")
            .send(validBus);

        expect(response.status).toBe(201);
        expect(response.body.message).toBe("Bus added successfully");
        expect(response.body.bus_id).toBe(1);
    });

    test("POST / should reject duplicate bus numbers", async () => {
        const duplicateError = new Error("Duplicate entry");
        duplicateError.code = "ER_DUP_ENTRY";

        pool.execute.mockRejectedValueOnce(duplicateError);

        const response = await request(app)
            .post("/")
            .send(validBus);

        expect(response.status).toBe(409);
        expect(response.body.message).toBe("Bus number already exists");
    });

    test("GET / should return all buses", async () => {
        const buses = [
            {
                id: 1,
                bus_name: "Express Travels",
                bus_number: "KA01AB1234",
                source: "Bangalore",
                destination: "Hyderabad"
            }
        ];

        pool.execute.mockResolvedValueOnce([buses, []]);

        const response = await request(app).get("/");

        expect(response.status).toBe(200);
        expect(response.body.count).toBe(1);
        expect(response.body.buses[0].bus_name)
            .toBe("Express Travels");
    });

    test("GET /search should reject missing route details", async () => {
        const response = await request(app).get("/search");

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Source and destination are required");
    });

    test("GET /search should reject an invalid date format", async () => {
        const response = await request(app)
            .get("/search")
            .query({
                source: "Bangalore",
                destination: "Hyderabad",
                date: "15-01-2027"
            });

        expect(response.status).toBe(400);
        expect(response.body.message)
            .toBe("Date must be in YYYY-MM-DD format");
    });

    test("GET /search should return matching buses", async () => {
        pool.execute.mockResolvedValueOnce([
            [{
                id: 1,
                bus_name: "Express Travels",
                source: "Bangalore",
                destination: "Hyderabad"
            }],
            []
        ]);

        const response = await request(app)
            .get("/search")
            .query({
                source: "Bangalore",
                destination: "Hyderabad",
                date: "2027-01-15"
            });

        expect(response.status).toBe(200);
        expect(response.body.count).toBe(1);
        expect(response.body.buses[0].destination)
            .toBe("Hyderabad");
    });

    test("GET /:id should reject an invalid bus ID", async () => {
        const response = await request(app).get("/abc");

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("Invalid bus ID");
    });

    test("GET /:id should return a bus by ID", async () => {
        pool.execute.mockResolvedValueOnce([
            [{
                id: 1,
                bus_name: "Express Travels",
                bus_number: "KA01AB1234"
            }],
            []
        ]);

        const response = await request(app).get("/1");

        expect(response.status).toBe(200);
        expect(response.body.bus.id).toBe(1);
    });

    test("GET /:id should return 404 when bus does not exist", async () => {
        pool.execute.mockResolvedValueOnce([[], []]);

        const response = await request(app).get("/999");

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Bus not found");
    });
});