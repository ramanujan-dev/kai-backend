import { validationResult } from "express-validator";
import Account from "../models/Account.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";

// Helper function to format validation errors
const formatValidationErrors = (errors) => {
  return errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
    value: error.value,
  }));
};

// Create new account (savings or current)
export const createAccount = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(errors),
      });
    }

    const { accountType, initialDeposit = 0 } = req.body;
    const userId = req.user.userId;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check account limits (max 2 savings, 1 current per user)
    const existingAccounts = await Account.find({ userId, isActive: true });
    const savingsCount = existingAccounts.filter(
      (acc) => acc.accountType === "savings"
    ).length;
    const currentCount = existingAccounts.filter(
      (acc) => acc.accountType === "current"
    ).length;

    if (accountType === "savings" && savingsCount >= 2) {
      return res.status(400).json({
        success: false,
        message: "Maximum 2 savings accounts allowed per user",
      });
    }

    if (accountType === "current" && currentCount >= 1) {
      return res.status(400).json({
        success: false,
        message: "Only 1 current account allowed per user",
      });
    }

    // Create new account
    const account = new Account({
      userId,
      accountType,
      balance: initialDeposit,
    });

    await account.save();

    // Create initial deposit transaction if amount > 0
    if (initialDeposit > 0) {
      const transaction = new Transaction({
        toAccountId: account._id,
        toAccountNumber: account.accountNumber,
        amount: initialDeposit,
        transactionType: "deposit",
        description: "Account opening deposit",
        status: "completed",
        processedAt: new Date(),
        metadata: {
          initiatedBy: userId,
          channel: "web",
        },
      });

      await transaction.save();
    }

    // Return account data
    const accountData = {
      accountId: account._id,
      accountNumber: account.accountNumber,
      formattedAccountNumber: account.formattedAccountNumber,
      accountType: account.accountType,
      balance: account.balance,
      availableBalance: account.availableBalance,
      minimumBalance: account.minimumBalance,
      interestRate: account.interestRate,
      dailyTransactionLimit: account.dailyTransactionLimit,
      monthlyTransactionLimit: account.monthlyTransactionLimit,
      status: account.status,
      createdAt: account.createdAt,
    };

    res.status(201).json({
      success: true,
      message: "Account created successfully",
      data: accountData,
    });
  } catch (error) {
    console.error("Create account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create account",
    });
  }
};

// Get user's accounts
export const getUserAccounts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { includeInactive = false } = req.query;

    const query = { userId };
    if (!includeInactive) {
      query.isActive = true;
    }

    const accounts = await Account.find(query).sort({ createdAt: -1 });

    const accountsData = accounts.map((account) => ({
      accountId: account._id,
      accountNumber: account.accountNumber,
      formattedAccountNumber: account.formattedAccountNumber,
      accountType: account.accountType,
      balance: account.balance,
      availableBalance: account.availableBalance,
      minimumBalance: account.minimumBalance,
      interestRate: account.interestRate,
      dailyTransactionLimit: account.dailyTransactionLimit,
      monthlyTransactionLimit: account.monthlyTransactionLimit,
      todayTransactionAmount: account.todayTransactionAmount,
      monthTransactionAmount: account.monthTransactionAmount,
      status: account.status,
      freezeReason: account.freezeReason,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    }));

    res.status(200).json({
      success: true,
      data: accountsData,
    });
  } catch (error) {
    console.error("Get accounts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch accounts",
    });
  }
};

// Get account details by account number
export const getAccountByNumber = async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const userId = req.user.userId;

    const account = await Account.findOne({
      accountNumber,
      userId,
      isActive: true,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const accountData = {
      accountId: account._id,
      accountNumber: account.accountNumber,
      formattedAccountNumber: account.formattedAccountNumber,
      accountType: account.accountType,
      balance: account.balance,
      availableBalance: account.availableBalance,
      minimumBalance: account.minimumBalance,
      interestRate: account.interestRate,
      dailyTransactionLimit: account.dailyTransactionLimit,
      monthlyTransactionLimit: account.monthlyTransactionLimit,
      todayTransactionAmount: account.todayTransactionAmount,
      monthTransactionAmount: account.monthTransactionAmount,
      status: account.status,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };

    res.status(200).json({
      success: true,
      data: accountData,
    });
  } catch (error) {
    console.error("Get account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch account details",
    });
  }
};

// Get account balance
export const getAccountBalance = async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const userId = req.user.userId;

    const account = await Account.findOne({
      accountNumber,
      userId,
      isActive: true,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        balance: account.balance,
        availableBalance: account.availableBalance,
        minimumBalance: account.minimumBalance,
        lastUpdated: account.updatedAt,
      },
    });
  } catch (error) {
    console.error("Get balance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch account balance",
    });
  }
};

// Validate beneficiary account (for transfers)
export const validateBeneficiary = async (req, res) => {
  try {
    const { accountNumber } = req.params;

    const account = await Account.findByAccountNumber(accountNumber);

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Beneficiary account not found",
      });
    }

    if (!account.isActive || account.freezeReason !== "none") {
      return res.status(400).json({
        success: false,
        message: "Beneficiary account is not active",
      });
    }

    // Get account holder details
    const user = account.userId;

    res.status(200).json({
      success: true,
      data: {
        accountNumber: account.accountNumber,
        accountType: account.accountType,
        holderName: user.fullName,
        isActive: account.isActive,
        canReceiveTransfers: true,
      },
    });
  } catch (error) {
    console.error("Validate beneficiary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to validate beneficiary account",
    });
  }
};

// Deactivate account
export const deactivateAccount = async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const { reason } = req.body;
    const userId = req.user.userId;

    const account = await Account.findOne({
      accountNumber,
      userId,
      isActive: true,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Check if account has balance
    if (account.balance > account.minimumBalance) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot deactivate account with balance above minimum. Please withdraw excess funds first.",
      });
    }

    // Deactivate account
    account.isActive = false;
    account.freezeReason = "customer_request";
    await account.save();

    // Create transaction record
    const transaction = new Transaction({
      fromAccountId: account._id,
      fromAccountNumber: account.accountNumber,
      amount: 0,
      transactionType: "fee_debit",
      description: `Account deactivation - ${reason || "Customer request"}`,
      status: "completed",
      processedAt: new Date(),
      metadata: {
        initiatedBy: userId,
        channel: "web",
      },
    });

    await transaction.save();

    res.status(200).json({
      success: true,
      message: "Account deactivated successfully",
      data: {
        accountNumber: account.accountNumber,
        status: "inactive",
        deactivatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Deactivate account error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate account",
    });
  }
};

// Get account statement
export const getAccountStatement = async (req, res) => {
  try {
    const { accountNumber } = req.params;
    const {
      page = 1,
      limit = 25,
      startDate,
      endDate,
      transactionType,
    } = req.query;
    const userId = req.user.userId;

    const account = await Account.findOne({
      accountNumber,
      userId,
      isActive: true,
    });

    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Get transactions
    const transactions = await Transaction.findByAccount(account._id, {
      page: parseInt(page),
      limit: parseInt(limit),
      startDate,
      endDate,
      transactionType,
      status: "completed",
    });

    // Format transaction data
    const transactionData = transactions.map((txn) => ({
      transactionId: txn.transactionId,
      date: txn.createdAt,
      amount: txn.amount,
      type: txn.transactionType,
      description: txn.description,
      direction:
        txn.fromAccountId &&
        txn.fromAccountId.toString() === account._id.toString()
          ? "debit"
          : "credit",
      balance:
        txn.fromAccountId &&
        txn.fromAccountId.toString() === account._id.toString()
          ? txn.balances.fromAccountBalance
          : txn.balances.toAccountBalance,
      reference: txn.reference,
      status: txn.status,
    }));

    // Get total count for pagination
    const totalTransactions = await Transaction.countDocuments({
      $or: [{ fromAccountId: account._id }, { toAccountId: account._id }],
      status: "completed",
    });

    res.status(200).json({
      success: true,
      data: {
        account: {
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          currentBalance: account.balance,
        },
        transactions: transactionData,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalTransactions,
          totalPages: Math.ceil(totalTransactions / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get statement error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch account statement",
    });
  }
};
