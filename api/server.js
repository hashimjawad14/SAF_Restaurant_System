// server.js (updated for per-company JSON storage)
const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const basicAuth = require("express-basic-auth");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
// Optional: protect /api/orders with basic auth
// app.use("/api/orders", basicAuth({ users: { admin: "Secret@123#" }, challenge: true }));
app.use(express.json({ limit: "10mb" })); // increase a bit to allow base64 menu images

// Legacy global file paths (kept for backward compatibility)
const ORDERS_FILE = path.join(__dirname, "orders.json");
const ORDERS_FILE_TMP = path.join(__dirname, "orders.json.tmp");
const DESKS_FILE = path.join(__dirname, "desks.json");
const DESKS_FILE_TMP = path.join(__dirname, "desks.json.tmp");
const MENU_FILE = path.join(__dirname, "menu.json");
const MENU_FILE_TMP = path.join(__dirname, "menu.json.tmp");

// Per-company storage roots
const DATA_COMPANIES_DIR = path.join(__dirname, "data", "companies");
const MENUS_DIR = path.join(__dirname, "menus"); // kept for compatibility with older code
const UPLOADS_DIR = path.join(__dirname, "uploads"); // hold saved item images (public)

// Expose uploads directory
app.use("/uploads", express.static(UPLOADS_DIR));

// --- Helpers: file paths for company-scoped data ---
function companyDir(companyId) {
  const id = companyId ? String(companyId) : "default";
  return path.join(DATA_COMPANIES_DIR, id);
}
function companyFilePath(companyId, filename) {
  return path.join(companyDir(companyId), filename);
}
function companyOrdersPath(companyId) {
  return companyFilePath(companyId, "orders.json");
}
function companyOrdersTmpPath(companyId) {
  return companyFilePath(companyId, "orders.json.tmp");
}
function companyDesksPath(companyId) {
  return companyFilePath(companyId, "desks.json");
}
function companyDesksTmpPath(companyId) {
  return companyFilePath(companyId, "desks.json.tmp");
}
function companyMenuPath(companyId) {
  // We'll still write menu files under the MENUS_DIR for backwards compatibility of earlier helper functions,
  // but also ensure a copy exists in data/companies if desired.
  return path.join(MENUS_DIR, `${companyId || "default"}.json`);
}

// --- Generic JSON read / write (atomic) ---
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

async function writeJSONAtomic(obj, filePath, tmpPath) {
  const json = JSON.stringify(obj, null, 2);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // write tmp
  try {
    await fs.writeFile(tmpPath, json, "utf8");
  } catch (err) {
    console.error(`Failed to write temp file ${tmpPath}:`, err);
    try {
      await fs.writeFile(filePath, json, "utf8");
      console.warn(`Wrote directly to ${filePath} after tmp write failed.`);
      return;
    } catch (err2) {
      console.error(`Direct write to ${filePath} also failed:`, err2);
      throw err2;
    }
  }

  // rename tmp -> final
  try {
    await fs.rename(tmpPath, filePath);
    return;
  } catch (renameErr) {
    console.warn(`rename failed for ${tmpPath} -> ${filePath}:`, renameErr);
    try {
      await fs.unlink(filePath).catch(() => {});
      await fs.rename(tmpPath, filePath);
      return;
    } catch (fallbackErr) {
      console.warn(
        `Fallback rename (unlink+rename) failed for ${tmpPath} -> ${filePath}:`,
        fallbackErr
      );
      try {
        await fs.writeFile(filePath, json, "utf8");
        try {
          await fs.unlink(tmpPath).catch(() => {});
        } catch (_) {}
        return;
      } catch (finalErr) {
        console.error(`Final write fallback failed for ${filePath}:`, finalErr);
        try {
          await fs.unlink(tmpPath).catch(() => {});
        } catch (_) {}
        throw finalErr;
      }
    }
  }
}

// --- Backwards-compatible order read/write (company optional) ---
async function readOrders(companyId = null) {
  if (companyId) {
    const file = companyOrdersPath(companyId);
    return readJSON(file, []);
  }
  return readJSON(ORDERS_FILE, []);
}

async function writeOrders(orders, companyId = null) {
  if (companyId) {
    const file = companyOrdersPath(companyId);
    const tmp = companyOrdersTmpPath(companyId);
    return writeJSONAtomic(orders, file, tmp);
  }
  return writeJSONAtomic(orders, ORDERS_FILE, ORDERS_FILE_TMP);
}

// --- Backwards-compatible desks read/write (company optional) ---
async function readDesks(companyId = null) {
  if (companyId) {
    const file = companyDesksPath(companyId);
    // default structure
    const fallback = { numDesks: 10, desks: {} };
    // seed desks with empty objects up to 10 if missing
    const data = await readJSON(file, fallback);
    data.desks = data.desks || {};
    return data;
  }
  return readJSON(DESKS_FILE, { numDesks: 10, desks: {} });
}

async function writeDesks(data, companyId = null) {
  if (companyId) {
    const file = companyDesksPath(companyId);
    const tmp = companyDesksTmpPath(companyId);
    return writeJSONAtomic(data, file, tmp);
  }
  return writeJSONAtomic(data, DESKS_FILE, DESKS_FILE_TMP);
}

// --- Menu helpers: we already have writeMenuCompany earlier in your file, but we will use a company-aware approach ---
// Reuse earlier writeMenuCompany but adapt to ensure saving both under MENUS_DIR and under data/companies for convenience

// write menu for a company and save any base64 images to /uploads/menus/{companyId}/{itemId}.{ext}
async function writeMenuCompany(companyId, menuObj) {
  const id = companyId ? String(companyId) : "default";

  // Ensure canonical directories
  const canonicalMenuPath = path.join(MENUS_DIR, `${id}.json`);
  await fs.mkdir(MENUS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });

  const menuUploadsDir = path.join(UPLOADS_DIR, "menus", String(id));
  await fs.mkdir(menuUploadsDir, { recursive: true });

  // Walk categories/items and save any "imageData" (dataURL) fields to disk
  for (const [catKey, cat] of Object.entries(menuObj || {})) {
    if (!cat || !Array.isArray(cat.items)) continue;
    for (const item of cat.items) {
      if (
        typeof item.imageData === "string" &&
        item.imageData.startsWith("data:")
      ) {
        const m = item.imageData.match(
          /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
        );
        if (m) {
          const ext = m[1].split("/")[1].split("+")[0]; // e.g. png, jpeg
          const filename = `${item.id || String(Date.now())}.${ext}`;
          const savePath = path.join(menuUploadsDir, filename);
          const buffer = Buffer.from(m[2], "base64");
          try {
            await fs.writeFile(savePath, buffer);
            // public URL used by clients
            item.image = `/uploads/menus/${encodeURIComponent(
              String(id)
            )}/${encodeURIComponent(filename)}`;
          } catch (err) {
            console.error("Failed to write menu image:", err);
          }
        }
        delete item.imageData;
      }
    }
  }

  // Save to canonical MENUS_DIR file (legacy compatibility)
  await writeJSONAtomic(menuObj, canonicalMenuPath, canonicalMenuPath + ".tmp");

  // Also save a copy under data/companies/{company}/menu.json for unified storage if desired
  const companyMenuFile = path.join(companyDir(id), "menu.json");
  await writeJSONAtomic(menuObj, companyMenuFile, companyMenuFile + ".tmp");

  return menuObj;
}

async function readMenuCompany(companyId) {
  const id = companyId ? String(companyId) : "default";
  const canonicalMenuPath = path.join(MENUS_DIR, `${id}.json`);
  const companyMenuFile = path.join(companyDir(id), "menu.json");

  // Preference order: company-specific file in data/companies -> MENUS_DIR file -> default fallback
  let data = await readJSON(companyMenuFile, null);
  if (data && typeof data === "object") return data;

  data = await readJSON(canonicalMenuPath, null);
  if (data && typeof data === "object") return data;

  // fallback default
  const defaultMenu = {
    coffee: {
      name: "Coffee",
      desc: "Corporate coffee selections",
      items: [
        { id: "espresso", name: "Espresso", value: "Espresso" },
        { id: "americano", name: "Americano", value: "Americano" },
        { id: "cappuccino", name: "Cappuccino", value: "Cappuccino" },
      ],
    },
  };
  return defaultMenu;
}

// --- Ensure required directories / default files exist (merged and robust) ---
async function ensureFilesExist() {
  // Ensure uploads & menus directory
  await fs.mkdir(MENUS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.mkdir(DATA_COMPANIES_DIR, { recursive: true });

  // Ensure default company directory exists
  const defaultCompanyDir = companyDir("default");
  await fs.mkdir(defaultCompanyDir, { recursive: true });

  // Ensure legacy global files exist (for backward compatibility)
  try {
    await fs.access(ORDERS_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("Creating legacy orders.json");
      await writeOrders([], null);
    }
  }

  try {
    await fs.access(DESKS_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("Creating legacy desks.json");
      const defaultDesks = { numDesks: 10, desks: {} };
      for (let i = 1; i <= 10; i++)
        defaultDesks.desks[String(i)] = { building: "", floor: "", teaBoy: "" };
      await writeDesks(defaultDesks, null);
    }
  }

  // Ensure default menu exists (both under MENUS_DIR and data/companies/default)
  try {
    await fs.access(path.join(MENUS_DIR, "default.json"));
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("Creating default menu.json");
      await writeMenuCompany("default", await readMenuCompany("default"));
    }
  }

  // Ensure a default orders/desks/menu exists for the "default" company in data/companies
  const defOrders = companyOrdersPath("default");
  try {
    await fs.access(defOrders);
  } catch (err) {
    if (err.code === "ENOENT") {
      await writeOrders([], "default");
    }
  }
  const defDesks = companyDesksPath("default");
  try {
    await fs.access(defDesks);
  } catch (err) {
    if (err.code === "ENOENT") {
      const defaultDesks = { numDesks: 10, desks: {} };
      for (let i = 1; i <= 10; i++)
        defaultDesks.desks[String(i)] = { building: "", floor: "", teaBoy: "" };
      await writeDesks(defaultDesks, "default");
    }
  }
  const defMenu = companyMenuPath("default");
  try {
    await fs.access(defMenu);
  } catch (err) {
    if (err.code === "ENOENT") {
      await writeMenuCompany("default", await readMenuCompany("default"));
    }
  }
}

// Simple request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// --- Routes: ORDERS (company-aware via ?company=) ---

// GET /api/orders?company=... - list orders (global if no company)
app.get("/api/orders", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const orders = await readOrders(companyId);
    res.json(orders);
  } catch (error) {
    console.error("Error reading orders:", error);
    res.status(500).json({ error: "Failed to read orders" });
  }
});

// GET /api/orders/:id?company=... - fetch specific order (try company if provided; otherwise search global)
app.get("/api/orders/:id", async (req, res) => {
  const companyId = req.query.company || null;
  const id = String(req.params.id);
  try {
    const orders = await readOrders(companyId);
    const order = orders.find((o) => String(o.id) === id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (error) {
    console.error("Error reading order:", error);
    res.status(500).json({ error: "Failed to read order" });
  }
});

// POST /api/orders?company=... - create new order for a company (or global if no company)
app.post("/api/orders", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    let newOrder = req.body || {};
    console.log(
      "Incoming new order payload:",
      JSON.stringify(newOrder).slice(0, 2000)
    );

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

    if (newOrder.desk !== undefined && newOrder.desk !== null)
      newOrder.desk = String(newOrder.desk);
    if (!Array.isArray(newOrder.items)) newOrder.items = [];

    if (!newOrder.id) {
      const ordersExisting = await readOrders(companyId);
      let candidate;
      do {
        candidate = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      } while (ordersExisting.some((o) => String(o.id) === candidate));
      newOrder.id = candidate;
      console.log("Generated id for incoming order:", newOrder.id);
    } else {
      newOrder.id = String(newOrder.id);
    }

    if (!newOrder.id || newOrder.desk === undefined || newOrder.desk === null) {
      return res.status(400).json({
        error:
          "Missing required fields: id, desk (string|number). 'items' should be an array (can be empty).",
      });
    }

    const orders = await readOrders(companyId);
    const idStr = String(newOrder.id);
    if (orders.some((o) => String(o.id) === idStr)) {
      return res
        .status(409)
        .json({ error: "Order with this ID already exists" });
    }

    if (!newOrder.timestamp) newOrder.timestamp = new Date().toISOString();
    if (!newOrder.status) newOrder.status = "pending";

    newOrder.id = idStr;
    orders.push(newOrder);

    await writeOrders(orders, companyId);

    try {
      const after = await readOrders(companyId);
      console.log(
        `Order persisted. ${companyId ? `company=${companyId} ` : ""}entries=${
          after.length
        } (last id=${newOrder.id}).`
      );
    } catch (rerr) {
      console.warn("Saved order but failed to read back:", rerr);
    }

    console.log(
      `New order created: ${newOrder.id} for Desk #${newOrder.desk} ${
        companyId ? `company=${companyId}` : ""
      }`
    );
    res.status(201).json(newOrder);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// PUT /api/orders/:id?company=... - update an order (company-aware)
app.put("/api/orders/:id", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const orders = await readOrders(companyId);
    const id = String(req.params.id);
    const idx = orders.findIndex((o) => String(o.id) === id);

    if (idx === -1) return res.status(404).json({ error: "Order not found" });

    const updated = { ...orders[idx], ...req.body, id: orders[idx].id };
    if (updated.desk !== undefined && updated.desk !== null)
      updated.desk = String(updated.desk);

    orders[idx] = updated;
    await writeOrders(orders, companyId);

    console.log(
      `Order updated: ${id} ${companyId ? `company=${companyId}` : ""}`
    );
    res.json(updated);
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// PUT /api/orders/bulk?company=... - replace all orders for company or global
app.put("/api/orders/bulk", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const incoming = req.body;
    if (!Array.isArray(incoming))
      return res
        .status(400)
        .json({ error: "Request body must be an array of orders" });

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

    await writeOrders(normalized, companyId);

    console.log(
      `Bulk update: ${normalized.length} orders ${
        companyId ? `company=${companyId}` : ""
      }`
    );
    res.json({
      message: "Orders updated successfully",
      count: normalized.length,
    });
  } catch (error) {
    console.error("Error bulk updating orders:", error);
    res.status(500).json({ error: "Failed to update orders" });
  }
});

// DELETE /api/orders/:id?company=... - delete single order
app.delete("/api/orders/:id", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const orders = await readOrders(companyId);
    const id = String(req.params.id);
    const idx = orders.findIndex((o) => String(o.id) === id);
    if (idx === -1) return res.status(404).json({ error: "Order not found" });
    const deleted = orders.splice(idx, 1)[0];
    await writeOrders(orders, companyId);
    console.log(
      `Order deleted: ${id} ${companyId ? `company=${companyId}` : ""}`
    );
    res.json(deleted);
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// DELETE /api/orders?company=... - clear all orders (company-aware)
app.delete("/api/orders", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    await writeOrders([], companyId);
    console.log(
      `All orders deleted ${companyId ? `company=${companyId}` : "global"}`
    );
    res.json({ message: "All orders deleted successfully" });
  } catch (error) {
    console.error("Error deleting all orders:", error);
    res.status(500).json({ error: "Failed to delete all orders" });
  }
});

// --- DESKS endpoints (company-aware) ---
// GET /api/desks?company=...
app.get("/api/desks", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const desks = await readDesks(companyId);
    res.json(desks);
  } catch (err) {
    console.error("Error reading desks:", err);
    res.status(500).json({ error: "Failed to read desks" });
  }
});

// POST /api/desks?company=...
app.post("/api/desks", async (req, res) => {
  const companyId = req.query.company || null;
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
    await writeDesks(payload, companyId);
    res.json(payload);
  } catch (err) {
    console.error("Error saving desks:", err);
    res.status(500).json({ error: "Failed to save desks" });
  }
});

// GET /api/desks/:id?company=...
app.get("/api/desks/:id", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const id = String(req.params.id);
    const data = await readDesks(companyId);
    const desk = data.desks?.[id];
    if (!desk) return res.status(404).json({ error: "Desk not found" });
    res.json(desk);
  } catch (err) {
    console.error("Error getting desk:", err);
    res.status(500).json({ error: "Failed to get desk" });
  }
});

// PUT /api/desks/:id?company=...
app.put("/api/desks/:id", async (req, res) => {
  const companyId = req.query.company || null;
  try {
    const id = String(req.params.id);
    const body = req.body || {};
    const data = await readDesks(companyId);
    data.desks = data.desks || {};
    data.desks[id] = body;
    const asNum = parseInt(id, 10);
    if (!isNaN(asNum) && (!data.numDesks || data.numDesks < asNum))
      data.numDesks = asNum;
    await writeDesks(data, companyId);
    res.json(data.desks[id]);
  } catch (err) {
    console.error("Error updating desk:", err);
    res.status(500).json({ error: "Failed to update desk" });
  }
});

// --- MENU endpoints (already company-aware) ---
// GET /api/menu?company=...
app.get("/api/menu", async (req, res) => {
  const companyId = req.query.company || "default";
  try {
    const menu = await readMenuCompany(companyId);
    res.json(menu);
  } catch (err) {
    console.error("Error reading menu:", err);
    res.status(500).json({ error: "Failed to read menu" });
  }
});

// POST /api/menu?company=...
app.post("/api/menu", async (req, res) => {
  const companyId = req.query.company || "default";
  try {
    await writeMenuCompany(companyId, req.body);
    const saved = await readMenuCompany(companyId);
    res.json(saved);
  } catch (err) {
    console.error("Error saving menu:", err);
    res.status(500).json({ error: "Failed to save menu" });
  }
});

// --- STATS (if desired keep company-agnostic for now) ---
app.get("/api/stats", async (req, res) => {
  try {
    // For backward compatibility compute stats across legacy global orders file
    // If you want per-company stats, call /api/orders?company=... and calculate on client/server.
    const orders = await readOrders(null);
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

// Serve static files (index.html and assets in project root)
app.use(express.static(path.join(__dirname, "..")));

// SPA fallback: non-API routes return index.html
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.resolve(__dirname, "..", "index.html"));
});

// 404 for anything else
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received; shutting down...");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("SIGINT received; shutting down...");
  process.exit(0);
});

// Start
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
