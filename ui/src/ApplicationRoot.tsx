import App from "./App";
import Withdrawal, { consumeWithdrawalLink } from "./Withdrawal";

const withdrawalToken = consumeWithdrawalLink();

export default function ApplicationRoot() {
  return withdrawalToken !== null ? <Withdrawal token={withdrawalToken} /> : <App />;
}
