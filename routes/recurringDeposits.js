import express from "express";
import { body, param, query } from "express-validator";
import {
  getRDRates,
  createRecurringDeposit,
  getUserRecurringDeposits,
  getRecurringDepositDetails,
  payInstallment,
  closeRecurringDeposit,
  toggleAutoDebit,
  getOverdueInstallments,
  getRDAnalytics,
  getInstallmentCalendar,
} from "../controllers/recurringDepositController.js";
import { authenticateToken, customerOnly } from "../middleware/auth.js";

const router = express.Router();

// Validation middleware
const createRDValidation = [
  body("fromAccountNumber")
    .isLength({ min: 10, max: 10 })
    .withMessage("Account number must be exactly 10 digits")
    .isNumeric()
    .withMessage("Account number must contain only numbers"),

  body("monthlyAmount")
    .isFloat({ min: 500, max: 100000 })
    .withMessage("Monthly amount must be between ₹500 and ₹1,00,000"),

  body("tenure")
    .isInt({ min: 12, max: 120 })
    .withMessage("Tenure must be between 12 and 120 months"),

  body("autoDebit")
    .optional()
    .isBoolean()
    .withMessage("Auto debit must be true or false"),

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

const rdNumberValidation = [
  param("rdNumber")
    .matches(/^\d{10}$/)
    .withMessage("Invalid RD number format"),
];

const listRDValidation = [
  query("status")
    .optional()
    .isIn(["active", "matured", "closed", "defaulted"])
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

const payInstallmentValidation = [
  body("paymentMethod")
    .optional()
    .isIn(["auto_debit", "manual", "cash", "cheque", "online"])
    .withMessage("Invalid payment method"),
];

const closeRDValidation = [
  body("reason")
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage("Reason cannot exceed 200 characters"),
];

const toggleAutoDebitValidation = [
  body("enabled").isBoolean().withMessage("Enabled must be true or false"),
];

const calendarValidation = [
  query("months")
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage("Months must be between 1 and 12"),
];

// Routes

// @route   GET /api/recurring-deposits/rates
// @desc    Get RD interest rates
// @access  Private (Customer only)
router.get("/rates", authenticateToken, customerOnly, getRDRates);

// @route   POST /api/recurring-deposits
// @desc    Create new Recurring Deposit
// @access  Private (Customer only)
router.post(
  "/",
  authenticateToken,
  customerOnly,
  createRDValidation,
  createRecurringDeposit
);

// @route   GET /api/recurring-deposits
// @desc    Get user's Recurring Deposits
// @access  Private (Customer only)
router.get(
  "/",
  authenticateToken,
  customerOnly,
  listRDValidation,
  getUserRecurringDeposits
);

// @route   GET /api/recurring-deposits/overdue
// @desc    Get overdue installments
// @access  Private (Customer only)
router.get("/overdue", authenticateToken, customerOnly, getOverdueInstallments);

// @route   GET /api/recurring-deposits/analytics
// @desc    Get RD analytics
// @access  Private (Customer only)
router.get("/analytics", authenticateToken, customerOnly, getRDAnalytics);

// @route   GET /api/recurring-deposits/calendar
// @desc    Get installment calendar
// @access  Private (Customer only)
router.get(
  "/calendar",
  authenticateToken,
  customerOnly,
  calendarValidation,
  getInstallmentCalendar
);

// @route   GET /api/recurring-deposits/:rdNumber
// @desc    Get RD details
// @access  Private (Customer only)
router.get(
  "/:rdNumber",
  authenticateToken,
  customerOnly,
  rdNumberValidation,
  getRecurringDepositDetails
);

// @route   POST /api/recurring-deposits/:rdNumber/pay
// @desc    Pay RD installment
// @access  Private (Customer only)
router.post(
  "/:rdNumber/pay",
  authenticateToken,
  customerOnly,
  rdNumberValidation,
  payInstallmentValidation,
  payInstallment
);

// @route   POST /api/recurring-deposits/:rdNumber/close
// @desc    Close RD prematurely
// @access  Private (Customer only)
router.post(
  "/:rdNumber/close",
  authenticateToken,
  customerOnly,
  rdNumberValidation,
  closeRDValidation,
  closeRecurringDeposit
);

// @route   PUT /api/recurring-deposits/:rdNumber/auto-debit
// @desc    Toggle auto-debit for RD
// @access  Private (Customer only)
router.put(
  "/:rdNumber/auto-debit",
  authenticateToken,
  customerOnly,
  rdNumberValidation,
  toggleAutoDebitValidation,
  toggleAutoDebit
);

export default router;
