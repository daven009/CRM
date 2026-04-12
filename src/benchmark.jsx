import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import BenchmarkView from "./components/BenchmarkView";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BenchmarkView standalone />
  </StrictMode>
);
