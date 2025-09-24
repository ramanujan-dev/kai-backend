import { validationResult } from "express-validator";
import Account from "../models/Account.js";
import Transaction from "../models/Transaction.js";
import mongoose from "mongoose";

// Helper function to format validation errors
const formatValidationErrors = (errors) => {
  return errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
    value: error.value,
  }));
};

// Transfer money between accounts
export const transferMoney = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(errors),
      });
    }

    const {
      fromAccountNumber,
      toAccountNumber,
      amount,
      description = "Money transfer",
      beneficiaryName,
    } = req.body;
    const userId = req.user.userId;

    // Validate amount
    if (amount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Transfer amount must be greater than zero",
      });
    }

    // Find source account
    const fromAccount = await Account.findOne({
      accountNumber: fromAccountNumber,
      userId,
      isActive: true,
    }).session(session);

    if (!fromAccount) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Source account not found or inactive",
      });
    }

    // Check if source account is not frozen
    if (fromAccount.freezeReason !== "none") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Source account is frozen. Please contact support.",
      });
    }

    // Find destination account
    const toAccount = await Account.findByAccountNumber(toAccountNumber);
    if (!toAccount) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Beneficiary account not found",
      });
    }

    if (!toAccount.isActive || toAccount.freezeReason !== "none") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Beneficiary account is inactive or frozen",
      });
    }

    // Check if transferring to same account
    if (fromAccountNumber === toAccountNumber) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cannot transfer to the same account",
      });
    }

    // Check transaction limits
    const canTransact = fromAccount.canTransact(amount);
    if (!canTransact.allowed) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: canTransact.reason,
      });
    }

    // Create transaction record
    const transaction = new Transaction({
      fromAccountId: fromAccount._id,
      toAccountId: toAccount._id,
      fromAccountNumber: fromAccount.accountNumber,
      toAccountNumber: toAccount.accountNumber,
      amount,
      transactionType: "transfer",
      description,
      status: "pending",
      metadata: {
        beneficiaryName: beneficiaryName || toAccount.userId.fullName,
        initiatedBy: userId,
        channel: "web",
        ipAddress: req.ip,
      },
    });

    await transaction.save({ session });

    try {
      // Debit from source account
      await fromAccount.debit(amount, `Transfer to ${toAccountNumber}`);

      // Credit to destination account
      await toAccount.credit(amount, `Transfer from ${fromAccountNumber}`);

      // Mark transaction as completed
      await transaction.complete(fromAccount.balance, toAccount.balance);

      await session.commitTransaction();

      res.status(200).json({
        success: true,
        message: "Transfer completed successfully",
        data: {
          transactionId: transaction.transactionId,
          fromAccount: fromAccountNumber,
          toAccount: toAccountNumber,
          amount: amount,
          description,
          timestamp: transaction.processedAt,
          newBalance: fromAccount.balance,
        },
      });
    } catch (transferError) {
      // Mark transaction as failed
      await transaction.fail(transferError.message);
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message: transferError.message,
      });
    }
  } catch (error) {
    await session.abortTransaction();
    console.error("Transfer error:", error);
    res.status(500).json({
      success: false,
      message: "Transfer failed. Please try again.",
    });
  } finally {
    session.endSession();
  }
};

// Deposit money to account
export const depositMoney = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(errors),
      });
    }

    const {
      accountNumber,
      amount,
      description = "Cash deposit",
      depositMethod = "cash",
    } = req.body;
    const userId = req.user.userId;

    // Validate amount
    if (amount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Deposit amount must be greater than zero",
      });
    }

    // Find account
    const account = await Account.findOne({
      accountNumber,
      userId,
      isActive: true,
    }).session(session);

    if (!account) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Account not found or inactive",
      });
    }

    // Check if account is not frozen
    if (account.freezeReason !== "none") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Account is frozen. Please contact support.",
      });
    }

    // Create transaction record
    const transaction = new Transaction({
      toAccountId: account._id,
      toAccountNumber: account.accountNumber,
      amount,
      transactionType: "deposit",
      description,
      status: "pending",
      metadata: {
        initiatedBy: userId,
        channel: "web",
        depositMethod,
        ipAddress: req.ip,
      },
    });

    await transaction.save({ session });

    // Credit account
    await account.credit(amount, description);

    // Mark transaction as completed
    await transaction.complete(null, account.balance);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Deposit completed successfully",
      data: {
        transactionId: transaction.transactionId,
        accountNumber,
        amount,
        description,
        timestamp: transaction.processedAt,
        newBalance: account.balance,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Deposit error:", error);
    res.status(500).json({
      success: false,
      message: "Deposit failed. Please try again.",
    });
  } finally {
    session.endSession();
  }
};

// Withdraw money from account
export const withdrawMoney = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: formatValidationErrors(errors),
      });
    }

    const {
      accountNumber,
      amount,
      description = "Cash withdrawal",
      withdrawalMethod = "atm",
    } = req.body;
    const userId = req.user.userId;

    // Validate amount
    if (amount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Withdrawal amount must be greater than zero",
      });
    }

    // Find account
    const account = await Account.findOne({
      accountNumber,
      userId,
      isActive: true,
    }).session(session);

    if (!account) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Account not found or inactive",
      });
    }

    // Check if account is not frozen
    if (account.freezeReason !== "none") {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Account is frozen. Please contact support.",
      });
    }

    // Check transaction limits
    const canTransact = account.canTransact(amount);
    if (!canTransact.allowed) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: canTransact.reason,
      });
    }

    // Create transaction record
    const transaction = new Transaction({
      fromAccountId: account._id,
      fromAccountNumber: account.accountNumber,
      amount,
      transactionType: "withdrawal",
      description,
      status: "pending",
      metadata: {
        initiatedBy: userId,
        channel: "web",
        withdrawalMethod,
        ipAddress: req.ip,
      },
    });

    await transaction.save({ session });

    try {
      // Debit account
      await account.debit(amount, description);

      // Mark transaction as completed
      await transaction.complete(account.balance, null);

      await session.commitTransaction();

      res.status(200).json({
        success: true,
        message: "Withdrawal completed successfully",
        data: {
          transactionId: transaction.transactionId,
          accountNumber,
          amount,
          description,
          timestamp: transaction.processedAt,
          newBalance: account.balance,
        },
      });
    } catch (withdrawError) {
      // Mark transaction as failed
      await transaction.fail(withdrawError.message);
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message: withdrawError.message,
      });
    }
  } catch (error) {
    await session.abortTransaction();
    console.error("Withdrawal error:", error);
    res.status(500).json({
      success: false,
      message: "Withdrawal failed. Please try again.",
    });
  } finally {
    session.endSession();
  }
};

// Get transaction history
export const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const {
      page = 1,
      limit = 25,
      accountNumber,
      transactionType,
      status = "completed",
      startDate,
      endDate,
    } = req.query;

    let transactions;

    if (accountNumber) {
      // Get transactions for specific account
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

      transactions = await Transaction.findByAccount(account._id, {
        page: parseInt(page),
        limit: parseInt(limit),
        transactionType,
        status,
        startDate,
        endDate,
      });
    } else {
      // Get all transactions for user
      transactions = await Transaction.findByUser(userId, {
        page: parseInt(page),
        limit: parseInt(limit),
        transactionType,
        status,
        startDate,
        endDate,
      });
    }

    // Format transaction data
    const transactionData = transactions.map((txn) => ({
      transactionId: txn.transactionId,
      date: txn.createdAt,
      processedAt: txn.processedAt,
      amount: txn.amount,
      type: txn.transactionType,
      description: txn.description,
      status: txn.status,
      fromAccount: txn.fromAccountNumber,
      toAccount: txn.toAccountNumber,
      reference: txn.reference,
      fees: txn.fees,
    }));

    res.status(200).json({
      success: true,
      data: {
        transactions: transactionData,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalTransactions: transactionData.length,
        },
      },
    });
  } catch (error) {
    console.error("Get transaction history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction history",
    });
  }
};

// Get transaction details by ID
export const getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user.userId;

    const transaction = await Transaction.findOne({ transactionId })
      .populate("fromAccountId", "accountNumber accountType userId")
      .populate("toAccountId", "accountNumber accountType userId")
      .populate("metadata.initiatedBy", "firstName lastName");

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Check if user has access to this transaction
    const hasAccess =
      (transaction.fromAccountId &&
        transaction.fromAccountId.userId.toString() === userId) ||
      (transaction.toAccountId &&
        transaction.toAccountId.userId.toString() === userId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const transactionData = {
      transactionId: transaction.transactionId,
      date: transaction.createdAt,
      processedAt: transaction.processedAt,
      amount: transaction.amount,
      type: transaction.transactionType,
      description: transaction.description,
      status: transaction.status,
      fromAccount: transaction.fromAccountNumber,
      toAccount: transaction.toAccountNumber,
      reference: transaction.reference,
      fees: transaction.fees,
      balances: transaction.balances,
      metadata: {
        channel: transaction.metadata.channel,
        beneficiaryName: transaction.metadata.beneficiaryName,
        initiatedBy: transaction.metadata.initiatedBy,
      },
    };

    res.status(200).json({
      success: true,
      data: transactionData,
    });
  } catch (error) {
    console.error("Get transaction details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction details",
    });
  }
};

// Get transaction analytics/summary
export const getTransactionAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { accountNumber, period = "30d" } = req.query;

    let analytics;

    if (accountNumber) {
      // Analytics for specific account
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

      analytics = await Transaction.getAnalytics(account._id, period);
    } else {
      // Analytics for all user accounts
      const userAccounts = await Account.find({ userId, isActive: true });
      const accountIds = userAccounts.map((acc) => acc._id);

      analytics = await Transaction.aggregate([
        {
          $match: {
            $or: [
              { fromAccountId: { $in: accountIds } },
              { toAccountId: { $in: accountIds } },
            ],
            status: "completed",
          },
        },
        {
          $group: {
            _id: "$transactionType",
            count: { $sum: 1 },
            totalAmount: { $sum: "$amount" },
            avgAmount: { $avg: "$amount" },
          },
        },
        {
          $sort: { totalAmount: -1 },
        },
      ]);
    }

    res.status(200).json({
      success: true,
      data: {
        analytics,
        period,
      },
    });
  } catch (error) {
    console.error("Get transaction analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction analytics",
    });
  }
};
