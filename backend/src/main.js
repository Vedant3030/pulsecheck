import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import jwt from "jsonwebtoken";
import { requireAuth } from "./middleware/auth.js";

const { PrismaClient } = pkg;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json()); // lets Express read JSON request bodies

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });

    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, createdAt: true },
  });
  res.json(user);
});

// CREATE a monitor
app.post("/monitors", requireAuth, async (req, res) => {
  try {
    const { url, name, intervalMins } = req.body;

    if (!url || !name) {
      return res.status(400).json({ error: "url and name are required" });
    }

    const monitor = await prisma.monitor.create({
      data: {
        url,
        name,
        intervalMins: intervalMins || 5,
        userId: req.userId,
      },
    });

    res.status(201).json(monitor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// READ all monitors for the logged-in user
app.get("/monitors", requireAuth, async (req, res) => {
  try {
    const monitors = await prisma.monitor.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(monitors);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// UPDATE a monitor
app.put("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { url, name, intervalMins, isActive } = req.body;

    const monitor = await prisma.monitor.findUnique({ where: { id } });

    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    const updated = await prisma.monitor.update({
      where: { id },
      data: { url, name, intervalMins, isActive },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// DELETE a monitor
app.delete("/monitors/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const monitor = await prisma.monitor.findUnique({ where: { id } });

    if (!monitor || monitor.userId !== req.userId) {
      return res.status(404).json({ error: "Monitor not found" });
    }

    await prisma.monitor.delete({ where: { id } });

    res.json({ message: "Monitor deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});