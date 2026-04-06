import { Route, Routes } from "react-router-dom";
import DesignSystemShowcasePage from "./pages/DesignSystemShowcasePage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DesignSystemShowcasePage />} />
    </Routes>
  );
}
