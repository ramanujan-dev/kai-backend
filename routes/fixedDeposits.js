import express from "express";
import { body, param, query } from "express-validator";
import {
  getFDRates,
  createFixedDeposit,
  getUserFixedDeposits,
  getFixedDepositDetails,
  closeFixedDeposit,
  processInterestPayout,
  getFDAnalytics,
} from "../controllers/fixedDepositController.js";
import { authenticateToken, customerOnly } from "../middleware/auth.js";

const router = express.Router();

// Validation middleware
const createFDValidation = [
  body("fromAccountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  body("principalAmount")
    .isFloat({ min: 1000, max: 10000000 })
    .withMessage("Principal amount must be between ₹1,000 and ₹1,00,00,000"),

  body("tenure")
    .isInt({ min: 6, max: 120 })
    .withMessage("Tenure must be between 6 and 120 months"),

  body("interestPayoutMode")
    .isIn(["cumulative", "monthly", "quarterly", "half_yearly", "yearly"])
    .withMessage("Invalid interest payout mode"),

  body("payoutAccountNumber")
    .optional()
    .isLength({ min: 10, max: 10 })
    .withMessage("Payout account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Payout account number must contain only numbers"),

  body("nominee.name")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Nominee name must be between 2 and 100 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Nominee name should only contain letters and spaces"),

  body("nominee.relationship")
    .isIn([
      "spouse",
      "son",
      "daughter",
      "father",
      "mother",
      "brother",
      "sister",
      "other",
    ])
    .withMessage("Invalid nominee relationship"),

  body("nominee.dateOfBirth")
    .optional()
    .isISO8601()
    .withMessage("Invalid nominee date of birth"),

  body("nominee.share")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Nominee share must be between 1 and 100"),
];

const fdNumberValidation = [
  param("fdNumber")
    .matches(/^\d{10}$/)
    .withMessage("Invalid FD number format"),
];

const listFDValidation = [
  query("status")
    .optional()
    .isIn(["active", "matured", "closed", "premature_closed"])
    .withMessage("Invalid status"),

  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Page must be a positive integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Limit must be between 1 and 50"),
];

const closeFDValidation = [
  body("reason")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Reason cannot exceed 200 characters"),
];

// Routes

// @route   GET /api/fixed-deposits/rates
// @desc    Get FD interest rates
// @access  Private (Customer only)
router.get("/rates", authenticateToken, customerOnly, getFDRates);

// @route   POST /api/fixed-deposits
// @desc    Create new Fixed Deposit
// @access  Private (Customer only)
router.post(
  "/",
  authenticateToken,
  customerOnly,
  createFDValidation,
  createFixedDeposit
);

// @route   GET /api/fixed-deposits
// @desc    Get user's Fixed Deposits
// @access  Private (Customer only)
router.get(
  "/",
  authenticateToken,
  customerOnly,
  listFDValidation,
  getUserFixedDeposits
);

// @route   GET /api/fixed-deposits/analytics
// @desc    Get FD analytics
// @access  Private (Customer only)
router.get("/analytics", authenticateToken, customerOnly, getFDAnalytics);

// @route   GET /api/fixed-deposits/:fdNumber
// @desc    Get FD details
// @access  Private (Customer only)
router.get(
  "/:fdNumber",
  authenticateToken,
  customerOnly,
  fdNumberValidation,
  getFixedDepositDetails
);

// @route   POST /api/fixed-deposits/:fdNumber/close
// @desc    Close FD prematurely
// @access  Private (Customer only)
router.post(
  "/:fdNumber/close",
  authenticateToken,
  customerOnly,
  fdNumberValidation,
  closeFDValidation,
  closeFixedDeposit
);

// @route   POST /api/fixed-deposits/:fdNumber/interest-payout
// @desc    Process interest payout
// @access  Private (Customer only)
router.post(
  "/:fdNumber/interest-payout",
  authenticateToken,
  customerOnly,
  fdNumberValidation,
  processInterestPayout
);

export default router;
