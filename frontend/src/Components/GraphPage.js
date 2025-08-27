import React from "react";
import { useLocation, Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import "./GraphPage.css"; // CSS import

function GraphPage() {
  const location = useLocation();
  const graphData = location.state?.graphData || [];

  return (
    <div className="graph-container">
      <div className="graph-header">
        <h1> Profit Trend (Per Date)</h1>
        <Link to="/" className="back-link">⬅ Back to Dashboard</Link>
      </div>

      {graphData.length > 0 ? (
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={graphData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="#4f46e5"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Profit (₹)"
              />
              <Line
                type="monotone"
                dataKey="profitPercent"
                stroke="#16a34a"
                strokeWidth={2}
                dot={{ r: 4 }}
                name="Profit (%)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="no-data">No graph data available</p>
      )}
    </div>
  );
}

export default GraphPage;
