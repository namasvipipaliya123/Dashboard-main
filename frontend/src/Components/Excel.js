import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import GraphPage from "./GraphPage";
import "./Excel.css";

function Dashboard() {
  const [file, setFile] = useState(null);
  const [subOrderNo, setSubOrderNo] = useState("");
  const [filterResult, setFilterResult] = useState(null);
  const [graphData, setGraphData] = useState([]);
  const [data, setData] = useState({
    all: 0,
    rto: 0,
    door_step_exchanged: 0,
    delivered: 0,
    cancelled: 0,
    ready_to_ship: 0,
    shipped: 0,
    other: 0,
    totalSupplierListedPrice: 0,
    totalSupplierDiscountedPrice: 0,
    sellInMonth: 0,
    totalProfit: 0,
    deliveredSupplierDiscountedPriceTotal: 0,
    totalDoorStepExchanger: 0,
  });

  const [profitPercent, setProfitPercent] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [showFilteredView, setShowFilteredView] = useState(false);

  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const queryId = query.get("i"); 

  useEffect(() => {
    if (queryId) {
      setSubOrderNo(queryId);
      handleFilter(queryId);
    }

  }, [queryId]);

  const handleDownload = () => {
    fetch("http://localhost:5000/download", {
      method: "GET",
      headers: { Accept: "application/pdf" },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to download");
        return res.blob();
      })
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", "dashboard-report.pdf");
        document.body.appendChild(link);
        link.click();
        link.remove();
      })
      .catch((err) => {
        console.error("Download error:", err);
        alert(" Failed to download PDF. Please try again.");
      });
  };

  const validateFile = (file) => {
    return (
      file &&
      (file.name.endsWith(".csv") ||
        file.name.endsWith(".xlsx") ||
        file.name.endsWith(".xls"))
    );
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (validateFile(selectedFile)) {
      setFile(selectedFile);
    } else {
      alert("Please upload a valid CSV or Excel file");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (validateFile(droppedFile)) {
      setFile(droppedFile);
    } else {
      alert("Only .csv or .xlsx files are supported");
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  const handleFilter = async (subNo = subOrderNo) => {
    if (!subNo) {
      alert("Please enter a Sub Order No.");
      return;
    }
    try {
      const res = await axios.get(`http://localhost:5000/filter/${subNo}`);
      setFilterResult(res.data);

      const calcProfit = 500 - res.data.discountedPrice;
      const calcProfitPercent = (calcProfit / 500) * 100;
      setProfitPercent(calcProfitPercent.toFixed(2));
      setShowFilteredView(true);
    } catch (err) {
      console.error("Filter failed", err);
      alert("No matching sub order found");
    }
  };

  const handleSubmitAll = async () => {
    if (!file) {
      alert("Please select a file first");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      const uploadRes = await axios.post(
        "http://localhost:5000/upload",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );

      const result = uploadRes.data;
      const totalListed = result.totals?.totalSupplierListedPrice || 0;
      const totalDiscounted = result.totals?.totalSupplierDiscountedPrice || 0;
      const totalProfit = result.totals?.totalProfit || 0;
      const deliveredTotalDiscounted =
        result.totals?.deliveredSupplierDiscountedPriceTotal || 0;
      const totalDoorStepExchanger =
        result.totals?.totalDoorStepExchanger || 0;
      const sellInMonthProducts = result.totals?.sellInMonthProducts || 0;

      const updatedData = {
        all: result.all?.length || 0,
        rto: result.rto?.length || 0,
        door_step_exchanged: result.door_step_exchanged?.length || 0,
        delivered: result.delivered?.length || 0,
        cancelled: result.cancelled?.length || 0,
        ready_to_ship: result.ready_to_ship?.length || 0,
        shipped: result.shipped?.length || 0,
        other: result.other?.length || 0,
        totalSupplierListedPrice: totalListed,
        totalSupplierDiscountedPrice: totalDiscounted,
        sellInMonth: sellInMonthProducts,
        totalProfit,
        deliveredSupplierDiscountedPriceTotal: deliveredTotalDiscounted,
        totalDoorStepExchanger,
      };

      setData(updatedData);

      const calcProfitPercent =
        sellInMonthProducts > 0
          ? (totalProfit / (sellInMonthProducts * 500)) * 100
          : 0;
      setProfitPercent(calcProfitPercent.toFixed(2));

      // 🔹 Profit Graph Data
      if (result.profitByDate) {
        let graphArr = [];
        if (!Array.isArray(result.profitByDate)) {
          graphArr = Object.entries(result.profitByDate).map(([date, profit]) => {
            const percent =
              sellInMonthProducts > 0
                ? ((profit / (sellInMonthProducts * 500)) * 100).toFixed(2)
                : 0;
            return { date, profit, profitPercent: parseFloat(percent) };
          });
        } else {
          graphArr = result.profitByDate.map((item) => {
            const percent =
              sellInMonthProducts > 0
                ? ((item.profit / (sellInMonthProducts * 500)) * 100).toFixed(2)
                : 0;
            return { ...item, profitPercent: parseFloat(percent) };
          });
        }
        setGraphData(graphArr);
      }

      alert(" File processed and data saved to MongoDB!");
    } catch (err) {
      console.error("Submit all failed", err);
      alert(" Failed to process & store data");
    }
  };

  return (
    <div className="App">
      <nav className="navbar">
        <div className="navbar-logo">Meesho</div>
        <div className="navbar-search">
          <input
            type="search"
            placeholder="Add here Sub Order No"
            value={subOrderNo}
            onChange={(e) => setSubOrderNo(e.target.value)}
          />
          <button className="back-btn" onClick={() => handleFilter()}>
            Filter
          </button>
          {showFilteredView && (
            <button
              className="back-btn"
              onClick={() => {
                setShowFilteredView(false);
                setProfitPercent(0);
              }}
            >
              Back
            </button>
          )}
        </div>
      </nav>

      <h1 className="heading">Product Status Dashboard</h1>

      {/* rest of your UI same as before ... */}

      <div style={{ margin: "20px 0" }}>
        <Link
          to="/graph"
          state={{ graphData }}
          style={{
            backgroundColor: "#17a2b8",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: "6px",
            textDecoration: "none",
          }}
        >
          Show Profit Graph
        </Link>
      </div>
    </div>
  );
}

/* ---------------- Router Setup ---------------- */
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/graph" element={<GraphPage />} />
      </Routes>
    </Router>
  );
}

export default App;
