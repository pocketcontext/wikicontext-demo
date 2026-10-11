import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import Withdrawal, { consumeWithdrawalLink } from "./Withdrawal";
const withdrawalToken = consumeWithdrawalLink();
const isWithdrawal = withdrawalToken !== null;
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <>{isWithdrawal ? <Withdrawal token={withdrawalToken ?? ""} /> : <App />}</>
  </React.StrictMode>,
);
