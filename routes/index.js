import express from "express";
import authRoutes from "./auth.js";
import adminRoutes from "./admin.js";
import accountRoutes from "./accounts.js";
import fixedDepositRoutes from "./fixedDeposits.js";
import recurringDepositRoutes from "./recurringDeposits.js";
import transactionRoutes from "./transactions.js";
import { authLimiter } from "../middleware/limitter.js";

const router = express.Router();

// Mount the sub-routers to a specific path
// All auth routes will be under /auth
router.use("/auth", authLimiter, authRoutes);
router.use("/admin", adminRoutes);
router.use("/accounts", accountRoutes);
router.use("/transactions", transactionRoutes);
router.use("/fixed-deposits", fixedDepositRoutes);
router.use("/recurring-deposits", recurringDepositRoutes);

export default router;
