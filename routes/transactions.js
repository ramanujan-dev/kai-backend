import express from "express";
import { body, param, query } from "express-validator";
import {
  transferMoney,
  depositMoney,
  withdrawMoney,
  getTransactionHistory,
  getTransactionDetails,
  getTransactionAnalytics,
} from "../controllers/transactionController.js";
import { authenticateToken, customerOnly } from "../middleware/auth.js";

const router = express.Router();

// Validation middleware
const transferValidation = [
  body("fromAccountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("From account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("From account number must contain only numbers"),

  body("toAccountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("To account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("To account number must contain only numbers"),

  body("amount")
    .isFloat({ min: 0.01 })
    .withMessage("Amount must be greater than 0")
    .custom((value) => {
      if (value > 500000) {
        throw new Error(
          "Transfer amount cannot exceed ₹5,00,000 per transaction"
        );
      }
      return true;
    }),

  body("description")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Description must be between 1 and 500 characters"),

  body("beneficiaryName")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Beneficiary name must be between 2 and 100 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Beneficiary name should only contain letters and spaces"),
];

const depositValidation = [
  body("accountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  body("amount")
    .isFloat({ min: 1 })
    .withMessage("Deposit amount must be at least ₹1")
    .custom((value) => {
      if (value > 200000) {
        throw new Error(
          "Cash deposit amount cannot exceed ₹2,00,000 per transaction"
        );
      }
      return true;
    }),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("depositMethod")
    .optional()
    .isIn(["cash", "cheque", "online", "card"])
    .withMessage("Invalid deposit method"),
];

const withdrawalValidation = [
  body("accountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  body("amount")
    .isFloat({ min: 100 })
    .withMessage("Withdrawal amount must be at least ₹100")
    .custom((value) => {
      if (value > 25000) {
        throw new Error("Daily withdrawal limit is ₹25,000");
      }
      if (value % 100 !== 0) {
        throw new Error("Withdrawal amount must be in multiples of ₹100");
      }
      return true;
    }),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("withdrawalMethod")
    .optional()
    .isIn(["atm", "branch", "online", "cheque"])
    .withMessage("Invalid withdrawal method"),
];

const transactionHistoryValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

  query("accountNumber")
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  query("transactionType")
    .optional()
    .isIn([
      "transfer",
      "deposit",
      "withdrawal",
      "fd_deposit",
      "rd_deposit",
      "interest_credit",
      "fee_debit",
    ])
    .withMessage("Invalid transaction type"),

  query("status")
    .optional()
    .isIn(["pending", "completed", "failed", "reversed"])
    .withMessage("Invalid status"),

  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("Start date must be in ISO format"),

  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("End date must be in ISO format"),
];

const transactionIdValidation = [
  param("transactionId")
    .matches(/^TXN\d{8}\d{6}$/)
    .withMessage("Invalid transaction ID format"),
];

const analyticsValidation = [
  query("accountNumber")
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  query("period")
    .optional()
    .isIn(["7d", "30d", "90d", "1y"])
    .withMessage("Period must be one of: 7d, 30d, 90d, 1y"),
];

// Routes

// @route   POST /api/transactions/transfer
// @desc    Transfer money between accounts
// @access  Private (Customer only)
router.post(
  "/transfer",
  authenticateToken,
  customerOnly,
  transferValidation,
  transferMoney
);

// @route   POST /api/transactions/deposit
// @desc    Deposit money to account
// @access  Private (Customer only)
router.post(
  "/deposit",
  authenticateToken,
  customerOnly,
  depositValidation,
  depositMoney
);

// @route   POST /api/transactions/withdraw
// @desc    Withdraw money from account
// @access  Private (Customer only)
router.post(
  "/withdraw",
  authenticateToken,
  customerOnly,
  withdrawalValidation,
  withdrawMoney
);

// @route   GET /api/transactions
// @desc    Get transaction history
// @access  Private (Customer only)
router.get(
  "/",
  authenticateToken,
  customerOnly,
  transactionHistoryValidation,
  getTransactionHistory
);

// @route   GET /api/transactions/:transactionId
// @desc    Get transaction details by ID
// @access  Private (Customer only)
router.get(
  "/:transactionId",
  authenticateToken,
  customerOnly,
  transactionIdValidation,
  getTransactionDetails
);

// @route   GET /api/transactions/analytics/summary
// @desc    Get transaction analytics
// @access  Private (Customer only)
router.get(
  "/analytics/summary",
  authenticateToken,
  customerOnly,
  analyticsValidation,
  getTransactionAnalytics
);

export default router;
