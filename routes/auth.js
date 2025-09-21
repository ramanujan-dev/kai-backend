const express = require("express");
const { body } = require("express-validator");
const {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  verifyToken,
} = require("../controllers/authController");
const { authenticateToken, authenticatedOnly } = require("../middleware/auth");

const router = express.Router();

// Validation middleware
const registerValidation = [
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
    .withMessage("City must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("City should only contain letters and spaces"),

  body("address.state")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("State must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("State should only contain letters and spaces"),

  body("address.pincode")
    .isLength({ min: 6, max: 6 })
    .withMessage("Pincode must be exactly 6 digits")
    .isNumeric()
    .withMessage("Pincode should only contain numbers"),

  body("dateOfBirth")
    .isISO8601()
    .withMessage("Please provide a valid date of birth")
    .custom((value) => {
      const today = new Date();
      const birthDate = new Date(value);
      const age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        age--;
      }

      if (age < 18) {
        throw new Error("Must be at least 18 years old");
      }

      if (age > 120) {
        throw new Error("Invalid date of birth");
      }

      return true;
    }),
];

const loginValidation = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Please provide a valid email address"),

  body("password").notEmpty().withMessage("Password is required"),
];

const updateProfileValidation = [
  body("firstName")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("First name should only contain letters and spaces"),

  body("lastName")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("Last name should only contain letters and spaces"),

  body("phone")
    .optional()
    .isMobilePhone("en-IN")
    .withMessage("Please provide a valid Indian phone number"),

  body("address.street")
    .optional()
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage("Street address must be between 5 and 100 characters"),

  body("address.city")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("City must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("City should only contain letters and spaces"),

  body("address.state")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("State must be between 2 and 50 characters")
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage("State should only contain letters and spaces"),

  body("address.pincode")
    .optional()
    .isLength({ min: 6, max: 6 })
    .withMessage("Pincode must be exactly 6 digits")
    .isNumeric()
    .withMessage("Pincode should only contain numbers"),
];

const changePasswordValidation = [
  body("currentPassword")
    .notEmpty()
    .withMessage("Current password is required"),

  body("newPassword")
    .isLength({ min: 8 })
    .withMessage("New password must be at least 8 characters long")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      "New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
    ),

  body("confirmPassword").custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error("Password confirmation does not match new password");
    }
    return true;
  }),
];

// Routes

// @route   POST /api/auth/register
// @desc    Register a new customer
// @access  Public
router.post("/register", registerValidation, register);

// @route   POST /api/auth/login
// @desc    Login user (customer or admin)
// @access  Public
router.post("/login", loginValidation, login);

// @route   GET /api/auth/verify
// @desc    Verify JWT token
// @access  Private
router.get("/verify", authenticateToken, verifyToken);

// @route   GET /api/auth/profile
// @desc    Get current user profile
// @access  Private
router.get("/profile", authenticateToken, authenticatedOnly, getProfile);

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put(
  "/profile",
  authenticateToken,
  authenticatedOnly,
  updateProfileValidation,
  updateProfile
);

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put(
  "/change-password",
  authenticateToken,
  authenticatedOnly,
  changePasswordValidation,
  changePassword
);

module.exports = router;
