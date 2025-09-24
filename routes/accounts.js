import express from "express";
import { body, param, query } from "express-validator";
import {
  createAccount,
  getUserAccounts,
  getAccountByNumber,
  getAccountBalance,
  validateBeneficiary,
  deactivateAccount,
  getAccountStatement,
} from "../controllers/accountController.js";
import { authenticateToken, customerOnly } from "../middleware/auth.js";

const router = express.Router();

// Validation middleware
const createAccountValidation = [
  body("accountType")
    .isIn(["savings", "current"])
    .withMessage('Account type must be either "savings" or "current"'),

  body("initialDeposit")
    .optional()
    .isNumeric()
    .withMessage("Initial deposit must be a number")
    .custom((value) => {
      if (value < 0) {
        throw new Error("Initial deposit cannot be negative");
      }
      return true;
    }),
];

const accountNumberValidation = [
  param("accountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),
];

const deactivateAccountValidation = [
  body("reason")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Reason cannot exceed 200 characters"),
];

const statementValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("Start date must be in ISO format"),

  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("End date must be in ISO format"),

  query("transactionType")
    .optional()
    .isIn([
      "transfer",
      "deposit",
      "withdrawal",
      "fd_deposit",
      "rd_deposit",
      "interest_credit",
    ])
    .withMessage("Invalid transaction type"),
];

// Routes

// @route   POST /api/accounts
// @desc    Create new account (savings or current)
// @access  Private (Customer only)
router.post(
  "/",
  authenticateToken,
  customerOnly,
  createAccountValidation,
  createAccount
);

// @route   GET /api/accounts
// @desc    Get all user accounts
// @access  Private (Customer only)
router.get("/", authenticateToken, customerOnly, getUserAccounts);

// @route   GET /api/accounts/:accountNumber
// @desc    Get account details by account number
// @access  Private (Customer only)
router.get(
  "/:accountNumber",
  authenticateToken,
  customerOnly,
  accountNumberValidation,
  getAccountByNumber
);

// @route   GET /api/accounts/:accountNumber/balance
// @desc    Get account balance
// @access  Private (Customer only)
router.get(
  "/:accountNumber/balance",
  authenticateToken,
  customerOnly,
  accountNumberValidation,
  getAccountBalance
);

// @route   GET /api/accounts/:accountNumber/statement
// @desc    Get account statement
// @access  Private (Customer only)
router.get(
  "/:accountNumber/statement",
  authenticateToken,
  customerOnly,
  accountNumberValidation,
  statementValidation,
  getAccountStatement
);

// @route   GET /api/accounts/validate/:accountNumber
// @desc    Validate beneficiary account for transfers
// @access  Private (Customer only)
router.get(
  "/validate/:accountNumber",
  authenticateToken,
  customerOnly,
  accountNumberValidation,
  validateBeneficiary
);

// @route   PUT /api/accounts/:accountNumber/deactivate
// @desc    Deactivate account
// @access  Private (Customer only)
router.put(
  "/:accountNumber/deactivate",
  authenticateToken,
  customerOnly,
  accountNumberValidation,
  deactivateAccountValidation,
  deactivateAccount
);

export default router;
