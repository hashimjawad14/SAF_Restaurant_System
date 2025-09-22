// server.js
const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const basicAuth = require("express-basic-auth");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
// Protect all /api/orders routes with basic auth
// app.use(
//   "/api/orders",
//   basicAuth({
//     users: { admin: "Secret@123#" }, // username:password
//     challenge: true, // makes browser show login popup
//   })
// );
app.use(express.json({ limit: "1mb" })); // small limit to avoid huge payloads

// Data storage path
const ORDERS_FILE = path.join(__dirname, "orders.json");
const ORDERS_FILE_TMP = path.join(__dirname, "orders.json.tmp");

const DESKS_FILE = path.join(__dirname, "desks.json");
const DESKS_FILE_TMP = path.join(__dirname, "desks.json.tmp");
const MENU_FILE = path.join(__dirname, "menu.json");
const MENU_FILE_TMP = path.join(__dirname, "menu.json.tmp");

// Generic JSON read with fallback (used for desks/menu and orders read)
async function readJSON(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw || !raw.trim()) return fallback;
    try {
      return JSON.parse(raw);
    } catch (parseErr) {
      console.error(
        `JSON parse error in ${filePath} — returning fallback`,
        parseErr
      );
      return fallback;
    }
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    console.error(`Error reading ${filePath}:`, err);
    return fallback;
  }
}

// Robust atomic write with multi-strategy fallback
// Simpler and more reliable than a complex queue: write tmp -> rename -> fallback unlink+rename -> fallback writeFile direct
async function writeJSONAtomic(obj, filePath, tmpPath) {
  const json = JSON.stringify(obj, null, 2);

  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write tmp file first
  try {
    await fs.writeFile(tmpPath, json, "utf8");
  } catch (err) {
    console.error(`Failed to write temp file ${tmpPath}:`, err);
    // Try direct write as a last resort
    try {
      await fs.writeFile(filePath, json, "utf8");
      console.warn(`Wrote directly to ${filePath} after tmp write failed.`);
      return;
    } catch (err2) {
      console.error(`Direct write to ${filePath} also failed:`, err2);
      throw err2;
    }
  }

  // Try rename tmp -> final
  try {
    await fs.rename(tmpPath, filePath);
    return;
  } catch (renameErr) {
    console.warn(`rename failed for ${tmpPath} -> ${filePath}:`, renameErr);
    // Attempt to remove existing target then rename
    try {
      await fs.unlink(filePath).catch(() => {});
      await fs.rename(tmpPath, filePath);
      return;
    } catch (fallbackErr) {
      console.warn(
        `Fallback rename (unlink+rename) failed for ${tmpPath} -> ${filePath}:`,
        fallbackErr
      );
      // Final fallback: write directly to destination and try to remove tmp
      try {
        await fs.writeFile(filePath, json, "utf8");
        try {
          await fs.unlink(tmpPath).catch(() => {});
        } catch (_) {}
        return;
      } catch (finalErr) {
        console.error(`Final write fallback failed for ${filePath}:`, finalErr);
        // Clean up tmp file if present
        try {
          await fs.unlink(tmpPath).catch(() => {});
        } catch (_) {}
        throw finalErr;
      }
    }
  }
}

// --- Orders specific helpers (uses readJSON/writeJSONAtomic) ---

async function readOrders() {
  const fallback = [];
  return readJSON(ORDERS_FILE, fallback);
}

async function writeOrders(orders) {
  return writeJSONAtomic(orders, ORDERS_FILE, ORDERS_FILE_TMP);
}

/* === Desks & Menu helpers === */

// Desks helpers
async function readDesks() {
  const fallback = { numDesks: 0, desks: {} };
  return readJSON(DESKS_FILE, fallback);
}
async function writeDesks(data) {
  return writeJSONAtomic(data, DESKS_FILE, DESKS_FILE_TMP);
}

// Menu helpers
async function readMenu() {
  const defaultMenu = {
    coffee: {
      name: "Coffee",
      desc: "Corporate coffee selections",
      items: [
        { id: "espresso", name: "Espresso", value: "Espresso" },
        { id: "americano", name: "Americano", value: "Americano" },
        { id: "cappuccino", name: "Cappuccino", value: "Cappuccino" },
        { id: "latte", name: "Latte", value: "Latte" },
        { id: "mocha", name: "Mocha", value: "Mocha" },
      ],
    },
  };
  return readJSON(MENU_FILE, defaultMenu);
}
async function writeMenu(data) {
  return writeJSONAtomic(data, MENU_FILE, MENU_FILE_TMP);
}

/* === Initialization: ensure files exist to avoid race / rename problems === */
async function ensureFilesExist() {
  // Ensure orders file exists (create empty array if missing)
  try {
    await fs.access(ORDERS_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("orders.json not found — creating empty orders file");
      try {
        await writeOrders([]);
      } catch (writeErr) {
        console.error("Failed creating initial orders.json:", writeErr);
      }
    } else {
      console.warn("Error accessing orders.json:", err);
    }
  }

  // Ensure desks/menu exist with sensible defaults
  try {
    await fs.access(DESKS_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("desks.json not found — creating default desks file");
      const defaultDesks = { numDesks: 10, desks: {} };
      for (let i = 1; i <= 10; i++)
        defaultDesks.desks[String(i)] = { building: "", floor: "", teaBoy: "" };
      try {
        await writeDesks(defaultDesks);
      } catch (writeErr) {
        console.error("Failed creating initial desks.json:", writeErr);
      }
    }
  }

  try {
    await fs.access(MENU_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("menu.json not found — creating default menu file");
      try {
        await writeMenu(await readMenu()); // readMenu returns defaultMenu used by function
      } catch (writeErr) {
        console.error("Failed creating initial menu.json:", writeErr);
      }
    }
  }
}

// Simple request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// --- Routes ---

// GET /api/orders - list all orders
app.get("/api/orders", async (req, res) => {
  try {
    const orders = await readOrders();
    res.json(orders);
  } catch (error) {
    console.error("Error reading orders:", error);
    res.status(500).json({ error: "Failed to read orders" });
  }
});

// GET /api/orders/:id - fetch specific order
app.get("/api/orders/:id", async (req, res) => {
  try {
    const orders = await readOrders();
    const id = String(req.params.id);
    const order = orders.find((o) => String(o.id) === id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (error) {
    console.error("Error reading order:", error);
    res.status(500).json({ error: "Failed to read order" });
  }
});

// POST /api/orders - create new order (robust & forgiving)
app.post("/api/orders", async (req, res) => {
  try {
    let newOrder = req.body || {};
    // Log incoming payload for easier debugging
    console.log(
      "Incoming new order payload:",
      JSON.stringify(newOrder).slice(0, 2000)
    );

    // If items missing but itemsDetailed present, derive items array from itemsDetailed
    if (
      !Array.isArray(newOrder.items) &&
      Array.isArray(newOrder.itemsDetailed)
    ) {
      const derived = [];
      for (const d of newOrder.itemsDetailed) {
        const name =
          d && (d.name || d.value || d.id)
            ? d.name || d.value || d.id
            : undefined;
        const qty = Number.isFinite(Number(d.quantity))
          ? Math.max(0, parseInt(d.quantity, 10))
          : 0;
        if (name && qty > 0) {
          for (let i = 0; i < qty; i++) derived.push(name);
        }
      }
      newOrder.items = derived;
      console.log("Derived items from itemsDetailed:", newOrder.items);
    }

    // Accept desk as number or string; normalize to string for storage
    if (newOrder.desk !== undefined && newOrder.desk !== null) {
      newOrder.desk = String(newOrder.desk);
    }

    // Ensure items is an array (if still not, make it an empty array)
    if (!Array.isArray(newOrder.items)) {
      newOrder.items = [];
    }

    // If id missing, generate a safe unique id
    if (!newOrder.id) {
      // create candidate id and ensure uniqueness
      const ordersExisting = await readOrders();
      let candidate;
      do {
        candidate = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      } while (ordersExisting.some((o) => String(o.id) === candidate));
      newOrder.id = candidate;
      console.log("Generated id for incoming order:", newOrder.id);
    } else {
      newOrder.id = String(newOrder.id);
    }

    // Basic validation (id and desk are required; items may be empty but must be an array)
    if (!newOrder.id || newOrder.desk === undefined || newOrder.desk === null) {
      return res.status(400).json({
        error:
          "Missing required fields: id, desk (string|number). 'items' should be an array (can be empty).",
      });
    }

    const orders = await readOrders();

    // Prevent duplicates if ID already exists
    const idStr = String(newOrder.id);
    if (orders.some((o) => String(o.id) === idStr)) {
      return res
        .status(409)
        .json({ error: "Order with this ID already exists" });
    }

    // Fill defaults
    if (!newOrder.timestamp) newOrder.timestamp = new Date().toISOString();
    if (!newOrder.status) newOrder.status = "pending";

    // Normalize id to string again (defensive)
    newOrder.id = idStr;

    // Save complete payload (don't strip properties)
    orders.push(newOrder);

    // Write and then confirm by reading back the saved file for debug logging
    await writeOrders(orders);
    try {
      const after = await readOrders();
      console.log(
        `Order persisted. orders.json now has ${after.length} entries (last id=${newOrder.id}).`
      );
    } catch (rerr) {
      console.warn("Saved order but failed to read back orders.json:", rerr);
    }

    console.log(`New order created: ${newOrder.id} for Desk #${newOrder.desk}`);
    res.status(201).json(newOrder);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// PUT /api/orders/:id - update an order
app.put("/api/orders/:id", async (req, res) => {
  try {
    const orders = await readOrders();
    const id = String(req.params.id);
    const idx = orders.findIndex((o) => String(o.id) === id);

    if (idx === -1) return res.status(404).json({ error: "Order not found" });

    // Merge updates (don't allow id overwrites)
    const updated = { ...orders[idx], ...req.body, id: orders[idx].id };
    // Normalize desk to string if provided
    if (updated.desk !== undefined && updated.desk !== null)
      updated.desk = String(updated.desk);

    orders[idx] = updated;

    await writeOrders(orders);

    console.log(`Order updated: ${id}`);
    res.json(updated);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// PUT /api/orders/bulk - replace all orders
app.put("/api/orders/bulk", async (req, res) => {
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming)) {
      return res
        .status(400)
        .json({ error: "Request body must be an array of orders" });
    }

    // Ensure all ids are stringified; ensure desk normalized and timestamps set
    const normalized = incoming.map((o) => {
      const copy = { ...(o || {}) };
      if (copy.id !== undefined) copy.id = String(copy.id);
      else copy.id = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      if (copy.desk !== undefined && copy.desk !== null)
        copy.desk = String(copy.desk);
      if (!copy.timestamp) copy.timestamp = new Date().toISOString();
      if (!copy.status) copy.status = "pending";
      if (!Array.isArray(copy.items) && Array.isArray(copy.itemsDetailed)) {
        const derived = [];
        for (const d of copy.itemsDetailed || []) {
          const name =
            d && (d.name || d.value || d.id)
              ? d.name || d.value || d.id
              : undefined;
          const qty = Number.isFinite(Number(d.quantity))
            ? Math.max(0, parseInt(d.quantity, 10))
            : 0;
          if (name && qty > 0) {
            for (let i = 0; i < qty; i++) derived.push(name);
          }
        }
        copy.items = derived;
      }
      if (!Array.isArray(copy.items)) copy.items = [];
      return copy;
    });

    await writeOrders(normalized);

    console.log(`Bulk update: ${normalized.length} orders`);
    res.json({
      message: "Orders updated successfully",
      count: normalized.length,
    });
  } catch (error) {
    console.error("Error bulk updating orders:", error);
    res.status(500).json({ error: "Failed to update orders" });
  }
});

/* === NEW ROUTES: Desks & Menu endpoints === */

// GET /api/desks - get full desks config
app.get("/api/desks", async (req, res) => {
  try {
    const desks = await readDesks();
    res.json(desks);
  } catch (err) {
    console.error("Error reading desks:", err);
    res.status(500).json({ error: "Failed to read desks" });
  }
});

// POST /api/desks - replace desks config
app.post("/api/desks", async (req, res) => {
  try {
    const payload = req.body;
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.numDesks !== "number" ||
      typeof payload.desks !== "object"
    ) {
      return res.status(400).json({ error: "Invalid desks payload" });
    }
    await writeDesks(payload);
    res.json(payload);
  } catch (err) {
    console.error("Error saving desks:", err);
    res.status(500).json({ error: "Failed to save desks" });
  }
});

// GET /api/desks/:id - get single desk
app.get("/api/desks/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const data = await readDesks();
    const desk = data.desks?.[id];
    if (!desk) return res.status(404).json({ error: "Desk not found" });
    res.json(desk);
  } catch (err) {
    console.error("Error getting desk:", err);
    res.status(500).json({ error: "Failed to get desk" });
  }
});

// PUT /api/desks/:id - update single desk
app.put("/api/desks/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const body = req.body || {};
    const data = await readDesks();
    data.desks = data.desks || {};
    data.desks[id] = body;
    // keep numDesks consistent if needed
    const asNum = parseInt(id, 10);
    if (!isNaN(asNum) && (!data.numDesks || data.numDesks < asNum)) {
      data.numDesks = asNum;
    }
    await writeDesks(data);
    res.json(data.desks[id]);
  } catch (err) {
    console.error("Error updating desk:", err);
    res.status(500).json({ error: "Failed to update desk" });
  }
});

// GET /api/menu - return current menu (or default)
app.get("/api/menu", async (req, res) => {
  try {
    const menu = await readMenu();
    res.json(menu);
  } catch (err) {
    console.error("Error reading menu:", err);
    res.status(500).json({ error: "Failed to read menu" });
  }
});

// POST /api/menu - replace/save menu
app.post("/api/menu", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid menu payload" });
    }
    await writeMenu(payload);
    res.json(payload);
  } catch (err) {
    console.error("Error saving menu:", err);
    res.status(500).json({ error: "Failed to save menu" });
  }
});

/* === End desks/menu routes === */

// DELETE /api/orders/:id - delete single order
app.delete("/api/orders/:id", async (req, res) => {
  try {
    const orders = await readOrders();
    const id = String(req.params.id);
    const idx = orders.findIndex((o) => String(o.id) === id);

    if (idx === -1) return res.status(404).json({ error: "Order not found" });

    const deleted = orders.splice(idx, 1)[0];
    await writeOrders(orders);

    console.log(`Order deleted: ${id}`);
    res.json(deleted);
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// DELETE /api/orders - clear all orders
app.delete("/api/orders", async (req, res) => {
  try {
    await writeOrders([]);
    console.log("All orders deleted");
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    console.error("Error deleting all orders:", error);
    res.status(500).json({ error: "Failed to delete all orders" });
  }
});

// GET /api/stats - simple statistics
app.get("/api/stats", async (req, res) => {
  try {
    const orders = await readOrders();
    const today = new Date().toDateString();

    const stats = {
      total: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      inProgress: orders.filter((o) => o.status === "in-progress").length,
      completed: orders.filter((o) => o.status === "completed").length,
      completedToday: orders.filter(
        (o) =>
          o.status === "completed" &&
          o.timestamp &&
          new Date(o.timestamp).toDateString() === today
      ).length,
      byCompany: {},
      byDesk: {},
    };

    for (const order of orders) {
      const company = order.companyId || order.company || "unknown";
      stats.byCompany[company] = (stats.byCompany[company] || 0) + 1;

      const desk = String(order.desk || "unknown");
      stats.byDesk[desk] = (stats.byDesk[desk] || 0) + 1;
    }

    res.json(stats);
  } catch (error) {
    console.error("Error getting stats:", error);
    res.status(500).json({ error: "Failed to get statistics" });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Serve static dashboard (if present)
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));

// Serve static files (index.html and assets in this folder)
app.use(express.static(path.join(__dirname, "..")));

// Fallback: for all non-API routes, return index.html so SPA can handle routing
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.resolve(__dirname, "..", "index.html"));
});

// 404 for anything else
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Graceful shutdown handlers
process.on("SIGTERM", () => {
  console.log("SIGTERM received; shutting down...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("SIGINT received; shutting down...");
  process.exit(0);
});

// Start: ensure files exist then listen
(async function startServer() {
  try {
    await ensureFilesExist();
  } catch (err) {
    console.error("Initialization error:", err);
  }

  app.listen(PORT, () => {
    console.log(
      `🚀 Beverage Orders API Server running on http://localhost:${PORT}`
    );
    console.log(
      `📊 API endpoints: GET/POST /api/orders, GET /api/stats, GET /health`
    );
  });
})();

module.exports = app;
