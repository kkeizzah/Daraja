import express from "express";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Basic security & parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Serve static frontend from /public
app.use(express.static("public"));

/**
 * Demo in-memory store (replace with DB if needed)
 */
const payments = new Map();

/**
 * POST /api/pay
 * Body: { amount: number, phone: string, reference?: string }
 */
app.post("/api/pay", (req, res) => {
  const { amount, phone, reference = `REF-${Date.now()}` } = req.body || {};

  // Basic validation
  const errors = [];
  if (amount == null || isNaN(Number(amount)) || Number(amount) <= 0) {
    errors.push("Amount must be a positive number.");
  }
  if (!phone || !/^\+?\d{7,15}$/.test(String(phone))) {
    errors.push("Phone must be digits, optionally starting with +, length 7–15.");
  }
  if (errors.length) return res.status(400).json({ ok: false, errors });

  // Simulate a created payment
  const id = cryptoRandomId();
  const record = {
    id,
    amount: Number(amount),
    phone: String(phone),
    reference,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };
  payments.set(id, record);

  // Simulate async completion after a short delay
  setTimeout(() => {
    const r = payments.get(id);
    if (!r) return;
    r.status = "SUCCESS";
    r.completedAt = new Date().toISOString();
    payments.set(id, r);
  }, 2000);

  res.json({ ok: true, payment: record });
});

/**
 * GET /api/status/:id
 * Returns the payment status
 */
app.get("/api/status/:id", (req, res) => {
  const { id } = req.params;
  const record = payments.get(id);
  if (!record) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, payment: record });
});

/**
 * Utility: simple random id
 */
function cryptoRandomId(len = 20) {
  // Avoid built-in crypto for broader Node versions; simple ID is fine here
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
