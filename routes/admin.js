import express from "express";
import { body, param, query } from "express-validator";
import {
  getDashboardStats,
  getCustomers,
  getCustomerDetails,
  toggleCustomerStatus,
  getAllAccounts,
  toggleAccountStatus,
  getAllTransactions,
  createAdmin,
} from "../controllers/adminController.js";
import { authenticateToken, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// Validation middleware
const customerListValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

  query("search")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Search query must be between 2 and 50 characters"),

  query("status")
    .optional()
    .isIn(["active", "inactive"])
    .withMessage('Status must be either "active" or "inactive"'),

  query("sortBy")
    .optional()
    .isIn(["createdAt", "firstName", "lastName", "email", "lastLogin"])
    .withMessage("Invalid sort field"),

  query("sortOrder")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage('Sort order must be "asc" or "desc"'),
];

const customerIdValidation = [
  param("customerId").isMongoId().withMessage("Invalid customer ID format"),
];

const toggleStatusValidation = [
  body("action")
    .isIn(["freeze", "unfreeze"])
    .withMessage('Action must be either "freeze" or "unfreeze"'),

  body("reason")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Reason cannot exceed 200 characters"),
];

const accountListValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

  query("accountType")
    .optional()
    .isIn(["savings", "current"])
    .withMessage('Account type must be either "savings" or "current"'),

  query("status")
    .optional()
    .isIn(["active", "frozen", "inactive"])
    .withMessage('Status must be "active", "frozen", or "inactive"'),

  query("minBalance")
    .optional()
    .isNumeric()
    .withMessage("Minimum balance must be a number"),

  query("maxBalance")
    .optional()
    .isNumeric()
    .withMessage("Maximum balance must be a number"),

  query("sortBy")
    .optional()
    .isIn(["createdAt", "balance", "accountType"])
    .withMessage("Invalid sort field"),

  query("sortOrder")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage('Sort order must be "asc" or "desc"'),
];

const accountIdValidation = [
  param("accountId").isMongoId().withMessage("Invalid account ID format"),
];

const transactionListValidation = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Limit must be between 1 and 100"),

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
      "penalty_debit",
      "reversal",
    ])
    .withMessage("Invalid transaction type"),

  query("status")
    .optional()
    .isIn(["pending", "completed", "failed", "reversed"])
    .withMessage("Invalid status"),

  query("minAmount")
    .optional()
    .isNumeric()
    .withMessage("Minimum amount must be a number"),

  query("maxAmount")
    .optional()
    .isNumeric()
    .withMessage("Maximum amount must be a number"),

  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("Start date must be in ISO format"),

  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("End date must be in ISO format"),

  query("accountNumber")
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  query("customerId")
    .optional()
    .isMongoId()
    .withMessage("Invalid customer ID format"),

  query("sortBy")
    .optional()
    .isIn(["createdAt", "amount", "processedAt"])
    .withMessage("Invalid sort field"),

  query("sortOrder")
    .optional()
    .isIn(["asc", "desc"])
    .withMessage('Sort order must be "asc" or "desc"'),
];

const createAdminValidation = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
    ),

  body("firstName")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("First name should only contain letters and spaces"),

  body("lastName")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Last name should only contain letters and spaces"),

  body("phone")
    .isMobilePhone("en-IN")
    .withMessage("Please provide a valid Indian phone number"),

  body("address.street")
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage("Street address must be between 5 and 100 characters"),

  body("address.city")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("City must be between 2 and 50 characters"),

  body("address.state")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("State must be between 2 and 50 characters"),

  body("address.pincode")
    .isLength({ min: 6, max: 6 })
    .withMessage("Pincode must be exactly 6 digits")
    .isNumeric()
    .withMessage("Pincode should only contain numbers"),
];

// Routes

// @route   GET /api/admin/dashboard
// @desc    Get dashboard statistics
// @access  Private (Admin only)
router.get("/dashboard", authenticateToken, adminOnly, getDashboardStats);

// @route   POST /api/admin/create
// @desc    Create admin user (for initial setup)
// @access  Public (should be restricted in production)
router.post("/create", createAdminValidation, createAdmin);

// Customer Management Routes

// @route   GET /api/admin/customers
// @desc    Get all customers with pagination and filters
// @access  Private (Admin only)
router.get(
  "/customers",
  authenticateToken,
  adminOnly,
  customerListValidation,
  getCustomers
);

// @route   GET /api/admin/customers/:customerId
// @desc    Get customer details
// @access  Private (Admin only)
router.get(
  "/customers/:customerId",
  authenticateToken,
  adminOnly,
  customerIdValidation,
  getCustomerDetails
);

// @route   PUT /api/admin/customers/:customerId/status
// @desc    Freeze/Unfreeze customer
// @access  Private (Admin only)
router.put(
  "/customers/:customerId/status",
  authenticateToken,
  adminOnly,
  customerIdValidation,
  toggleStatusValidation,
  toggleCustomerStatus
);

// Account Management Routes

// @route   GET /api/admin/accounts
// @desc    Get all accounts with pagination and filters
// @access  Private (Admin only)
router.get(
  "/accounts",
  authenticateToken,
  adminOnly,
  accountListValidation,
  getAllAccounts
);

// @route   PUT /api/admin/accounts/:accountId/status
// @desc    Freeze/Unfreeze account
// @access  Private (Admin only)
router.put(
  "/accounts/:accountId/status",
  authenticateToken,
  adminOnly,
  accountIdValidation,
  toggleStatusValidation,
  toggleAccountStatus
);

// Transaction Management Routes

// @route   GET /api/admin/transactions
// @desc    Get all transactions with advanced filters
// @access  Private (Admin only)
router.get(
  "/transactions",
  authenticateToken,
  adminOnly,
  transactionListValidation,
  getAllTransactions
);

export default router;
