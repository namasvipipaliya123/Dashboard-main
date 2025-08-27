const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const PDFDocument = require("pdfkit-table");
const app = express();
const PORT = 5000;
const MONGO_URI = "mongodb+srv://pipaliyanamasvi:dashboard@dashboard.qk6clff.mongodb.net/?retryWrites=true&w=majority&appName=dashboard";
const DB_NAME = "dashboard_db";
let db;

MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then((client) => {
    db = client.db(DB_NAME);
    console.log(" Connected to MongoDB");
  })
  .catch((err) => console.error(" MongoDB connection failed:", err));

app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

const statusList = [
  "all",
  "rto",
  "door_step_exchanged",
  "delivered",
  "cancelled",
  "ready_to_ship",
  "shipped",
  "supplier_listed_price",
  "supplier_discounted_price",
];

function parsePrice(value) {
  if (!value) return 0;
  const clean = value.toString().trim().replace(/[^0-9.\-]/g, "");
  return parseFloat(clean) || 0;
}

function getColumnValue(row, possibleNames) {
  const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
  for (let name of possibleNames) {
    const idx = keys.indexOf(name.toLowerCase().trim());
    if (idx !== -1) return row[Object.keys(row)[idx]];
  }
  return 0;
}

function categorizeRows(rows) {
  const categories = {};
  statusList.forEach((status) => (categories[status] = []));
  categories.other = [];

  let totalSupplierListedPrice = 0;
  let totalSupplierDiscountedPrice = 0;
  let sellInMonthProducts = 0;
  let deliveredSupplierDiscountedPriceTotal = 0;
  let totalDoorStepExchanger = 0;

  rows.forEach((row) => {
    const status = (row["Reason for Credit Entry"] || "").toLowerCase().trim();
    categories["all"].push(row);

    const listedPrice = parsePrice(
      getColumnValue(row, [
        "Supplier Listed Price (Incl. GST + Commission)",
        "Supplier Listed Price",
        "Listed Price",
      ])
    );
    const discountedPrice = parsePrice(
      getColumnValue(row, [
        "Supplier Discounted Price (Incl GST and Commission)",
        "Supplier Discounted Price (Incl GST and Commision)",
        "Supplier Discounted Price",
        "Discounted Price",
      ])
    );  

    totalSupplierListedPrice += listedPrice;
    totalSupplierDiscountedPrice += discountedPrice;

    if (status.includes("delivered")) {
      sellInMonthProducts++;
      deliveredSupplierDiscountedPriceTotal += discountedPrice;
    }

    if (status.includes("door_step_exchanged")) {
      totalDoorStepExchanger += 80;
    }

    let matched = false;
    if (
      status.includes("rto_complete") ||
      status.includes("rto_locked") ||
      status.includes("rto_initiated")
    ) {
      categories["rto"].push(row);
      matched = true;
    } else {
      statusList.forEach((s) => {
        if (s !== "all" && s !== "rto" && status.includes(s)) {
          categories[s].push(row);
          matched = true;
        }
      });
    }
    if (!matched) categories.other.push(row);
  });

  const totalRevenue = deliveredSupplierDiscountedPriceTotal;
  const totalCost = sellInMonthProducts * 500; 
  const totalProfit = totalRevenue - totalCost;

const profitPercentCost = totalCost !== 0 ? ((totalProfit / totalCost) * 100) : 0;
const profitPercentRevenue = totalRevenue !== 0 ? ((totalProfit / totalRevenue) * 100) : 0;
  categories.totals = {
    totalSupplierListedPrice: Number(totalSupplierListedPrice.toFixed(2)),
    totalSupplierDiscountedPrice: Number(totalSupplierDiscountedPrice.toFixed(2)),
    sellInMonthProducts,
    deliveredSupplierDiscountedPriceTotal: Number(totalRevenue.toFixed(2)),
    totalDoorStepExchanger,
    totalProfit: Number(totalProfit.toFixed(2)),
    profitPercentRevenue: Number(profitPercentRevenue),
    profitPercentCost: Number(profitPercentCost),
    profitPercent: Number(profitPercentRevenue), 
  };

  return categories;
}



app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let rows = [];
  if (req.file.originalname.endsWith(".csv")) {
    rows = req.file.buffer.toString().split("\n"); // parse directly
  } else if (req.file.originalname.endsWith(".xlsx")) {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  }
  await saveToDB(rows, res);
});


async function saveToDB(rows, res) {
  if (!db) return res.status(500).json({ message: "MongoDB not connected yet" });
  if (!rows || !rows.length) return res.status(400).json({ message: "No data to save" });

  const categorized = categorizeRows(rows);

  const profitByDateAccumulator = {};
  rows.forEach((row) => {
    const status = (row["Reason for Credit Entry"] || "").toLowerCase().trim();
    if (!status.includes("delivered")) return;

    const dateKey =
      row["Order Date"] || row["Date"] || row["Created At"] || row["Delivered Date"];
    if (!dateKey) return;

    const date = new Date(dateKey).toISOString().split("T")[0];
    const discountedPrice = parsePrice(
      getColumnValue(row, [
        "Supplier Discounted Price (Incl GST and Commission)",
        "Supplier Discounted Price (Incl GST and Commision)",
        "Supplier Discounted Price",
        "Discounted Price",
      ])
    );

    if (!profitByDateAccumulator[date]) profitByDateAccumulator[date] = { totalRevenue: 0, count: 0 };
    profitByDateAccumulator[date].totalRevenue += discountedPrice;
    profitByDateAccumulator[date].count += 1;
  });

  const profitGraphArray = Object.keys(profitByDateAccumulator)
    .sort()
    .map((date) => {
      const { totalRevenue, count } = profitByDateAccumulator[date];
      const totalCostForDate = count * 500;
      const profit = totalRevenue - totalCostForDate;
      return {
        date,
        profit: Number(profit.toFixed(2)),
        profitPercentRevenue: Number(((profit / totalRevenue) * 100).toFixed(2)),
        profitPercentCost: Number(((profit / totalCostForDate) * 100).toFixed(2)),
      };
    });

  try {
    await db.collection("dashboard_data").insertOne({
      submittedAt: new Date(),
      data: rows,
      totals: categorized.totals,
      categories: categorized,
      profitByDate: profitGraphArray,
    });
    console.log(" Uploaded data inserted into MongoDB with profit graph");
    return res.json({ ...categorized, profitByDate: profitGraphArray });
  } catch (error) {
    console.error(" Error saving uploaded data to MongoDB:", error);
    return res.status(500).json({ message: "Failed to save data to MongoDB" });
  }
}

app.get("/profit-graph", async (req, res) => {
  try {
    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    return res.json(result[0].profitByDate || []);
  } catch (err) {
    console.error(" Profit graph error:", err);
    return res.status(500).json({ error: "Failed to generate profit graph data" });
  }
});

app.get("/filter/:subOrderNo", async (req, res) => {
  try {
    const subOrderNo = req.params.subOrderNo.trim().toLowerCase();
    if (!subOrderNo) return res.status(400).json({ error: "Sub Order No required" });

    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    const rows = result[0].data;
    const match = rows.find((row) => {
      const keys = Object.keys(row).map((k) => k.toLowerCase());
      const subOrderKey = keys.find((k) => k.includes("sub") && k.includes("order"));
      if (subOrderKey && row[subOrderKey] && row[subOrderKey].toString().trim().toLowerCase() === subOrderNo) return true;
      return Object.values(row).some((v) => v && v.toString().trim().toLowerCase() === subOrderNo);
    });

    if (!match) return res.status(404).json({ error: "Sub Order No not found" });

    const listedPrice = parsePrice(
      getColumnValue(match, ["Supplier Listed Price (Incl. GST + Commission)", "Supplier Listed Price", "Listed Price"])
    );
    const discountedPrice = parsePrice(
      getColumnValue(match, [
        "Supplier Discounted Price (Incl GST and Commission)",
        "Supplier Discounted Price (Incl GST and Commision)",
        "Supplier Discounted Price",
        "Discounted Price",
      ])
    );

    const profit = discountedPrice - 500;
    return res.json({
      subOrderNo,
      listedPrice,
      discountedPrice,
      profit: Number(profit.toFixed(2)),
      profitPercentOfPrice: Number(((profit / discountedPrice) * 100).toFixed(2)),
      profitPercentOfCost: Number(((profit / 500) * 100).toFixed(2)),
    });
  } catch (err) {
    console.error(" Filter error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/download", async (req, res) => {
  try {
    const result = await db
      .collection("dashboard_data")
      .find()
      .sort({ submittedAt: -1 })
      .limit(1)
      .toArray();

    if (!result.length) return res.status(404).json({ error: "No data found" });

    const latest = result[0];

    // ✅ Set headers for direct download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=dashboard-report.pdf");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res); // ✅ Directly stream to response (no fs required)

    doc.fontSize(22).fillColor("#2E86C1").text("📊 Dashboard Report", { align: "center" });
    doc.moveDown(1);

    // Summary table
    const summaryRows = [
      ["All Orders", latest.categories.all.length],
      ["RTO", latest.categories.rto.length],
      ["Door Step Exchanged (charges sum)", latest.totals.totalDoorStepExchanger],
      [
        "Delivered (count & revenue)",
        `${latest.categories.delivered.length} (₹${latest.totals.deliveredSupplierDiscountedPriceTotal})`
      ],
      ["Cancelled", latest.categories.cancelled.length],
      ["Pending", latest.categories.ready_to_ship.length],
      ["Shipped", latest.categories.shipped.length],
      ["Other", latest.categories.other.length],
      ["Supplier Listed Total Price", `₹${latest.totals.totalSupplierListedPrice}`],
      ["Supplier Discounted Total Price", `₹${latest.totals.totalSupplierDiscountedPrice}`],
      ["Total Profit (Revenue - Cost)", `₹${latest.totals.totalProfit}`],
      ["Profit % (of Revenue)", `${latest.totals.profitPercentRevenue}%`],
      ["Profit % (of Cost)", `${latest.totals.profitPercentCost}%`],
    ];

    await doc.table(
      { headers: ["Metric", "Value"], rows: summaryRows },
      {
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(12),
        prepareRow: (row) => doc.font("Helvetica").fontSize(11),
      }
    );

    doc.moveDown(1);

    // Profit by date table
    const profitRows = latest.profitByDate.map((p) => [
      p.date,
      `₹${p.profit}`,
      `${p.profitPercentRevenue}% (of revenue)`,
      `${p.profitPercentCost}% (of cost)`,
    ]);

    await doc.table(
      { headers: ["Date", "Profit (₹)", "Profit % (Revenue)", "Profit % (Cost)"], rows: profitRows },
      {
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(12),
        prepareRow: (row) => doc.font("Helvetica").fontSize(10),
      }
    );

    doc.end(); // ✅ finish PDF and send

  } catch (err) {
    console.error("PDF error:", err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});
app.get("/show-code", (req, res) => {
  const code = fs.readFileSync(__filename, "utf-8"); // read current file
  res.send(`
    <html>
      <head>
        <title>Server Code</title>
        <style>
          body { background: #1e1e1e; color: #d4d4d4; font-family: monospace; padding: 20px; }
          pre { white-space: pre-wrap; word-wrap: break-word; }
        </style>
      </head>
      <body>
        <pre>${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(` Server running on http://localhost:${PORT}`));
