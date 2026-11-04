const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();

app.use(express.json());

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from environment variables");
}

// Health check
app.get("/", (req, res) => {
    res.json({
        service: "user-service",
        status: "running"
    });
});

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
            service: "user-service",
            database: rows[0].database_name,
            connection: "successful"
        });
    } catch (error) {
        res.status(500).json({
            error: "Database connection failed"
        });
    }
});

// User registration
app.post("/register", async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Name, email and password are required"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                message: "Password must contain at least 8 characters"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [existingUsers] = await pool.execute(
            "SELECT id FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await pool.execute(
            `INSERT INTO users (name, email, password_hash, phone)
             VALUES (?, ?, ?, ?)`,
            [name.trim(), normalizedEmail, passwordHash, phone || null]
        );

        res.status(201).json({
            message: "User registered successfully",
            user: {
                id: result.insertId,
                name: name.trim(),
                email: normalizedEmail,
                phone: phone || null
            }
        });
    } catch (error) {
        console.error("Registration error:", error);

        res.status(500).json({
            message: "Registration failed"
        });
    }
});

// User login
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const [users] = await pool.execute(
            "SELECT * FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email
            },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone
            }
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            message: "Login failed"
        });
    }
});

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            message: "Access token required"
        });
    }

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(403).json({
            message: "Invalid or expired token"
        });
    }
}

// Get logged-in user's profile
app.get("/profile", authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT id, name, email, phone, created_at
             FROM users WHERE id = ?`,
            [req.user.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json({
            user: users[0]
        });
    } catch (error) {
        console.error("Profile error:", error);

        res.status(500).json({
            message: "Unable to retrieve profile"
        });
    }
});

module.exports = app;