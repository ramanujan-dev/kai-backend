import { validationResult } from "express-validator";
import FixedDeposit from "../models/FixedDeposit.js";
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

// Get FD interest rates
export const getFDRates = async (req, res) => {
  try {
    // Static FD rates - in real app, this would come from database
    const rates = [
      { tenure: 6, rate: 6.5, description: "6 months" },
      { tenure: 12, rate: 7.0, description: "1 year" },
      { tenure: 18, rate: 7.25, description: "18 months" },
      { tenure: 24, rate: 7.5, description: "2 years" },
      { tenure: 36, rate: 7.75, description: "3 years" },
      { tenure: 60, rate: 8.0, description: "5 years" },
      { tenure: 120, rate: 8.25, description: "10 years" },
    ];

    res.status(200).json({
      success: true,
      data: rates,
    });
  } catch (error) {
    console.error("Get FD rates error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch FD rates",
    });
  }
};

// Create new Fixed Deposit
export const createFixedDeposit = async (req, res) => {
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
      principalAmount,
      tenure,
      interestPayoutMode = "cumulative",
      payoutAccountNumber,
      nominee,
    } = req.body;
    const userId = req.user.userId;

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

    // Check if account has sufficient balance
    const canTransact = fromAccount.canTransact(principalAmount);
    if (!canTransact.allowed) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: canTransact.reason,
      });
    }

    // Determine interest rate based on tenure
    let interestRate;
    if (tenure >= 6 && tenure < 12) interestRate = 6.5;
    else if (tenure >= 12 && tenure < 18) interestRate = 7.0;
    else if (tenure >= 18 && tenure < 24) interestRate = 7.25;
    else if (tenure >= 24 && tenure < 36) interestRate = 7.5;
    else if (tenure >= 36 && tenure < 60) interestRate = 7.75;
    else if (tenure >= 60 && tenure < 120) interestRate = 8.0;
    else if (tenure >= 120) interestRate = 8.25;
    else {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid tenure. Minimum 6 months required.",
      });
    }

    // Find payout account if specified
    let payoutAccount = null;
    if (interestPayoutMode !== "cumulative" && payoutAccountNumber) {
      payoutAccount = await Account.findOne({
        accountNumber: payoutAccountNumber,
        userId,
        isActive: true,
      }).session(session);

      if (!payoutAccount) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Payout account not found or inactive",
        });
      }
    }

    // Create Fixed Deposit
    const fixedDeposit = new FixedDeposit({
      userId,
      fromAccountId: fromAccount._id,
      principalAmount,
      interestRate,
      tenure,
      interestPayoutMode,
      payoutAccountId: payoutAccount ? payoutAccount._id : null,
      nominee,
    });

    await fixedDeposit.save({ session });

    // Debit amount from source account
    await fromAccount.debit(
      principalAmount,
      `FD Creation - ${fixedDeposit.fdNumber}`
    );

    // Create transaction record
    const transaction = new Transaction({
      fromAccountId: fromAccount._id,
      fromAccountNumber: fromAccount.accountNumber,
      amount: principalAmount,
      transactionType: "fd_deposit",
      description: `Fixed Deposit created - ${fixedDeposit.formattedFdNumber}`,
      reference: fixedDeposit.fdNumber,
      status: "completed",
      processedAt: new Date(),
      metadata: {
        initiatedBy: userId,
        channel: "web",
      },
    });

    await transaction.save({ session });
    await session.commitTransaction();

    // Return FD details
    const fdData = {
      fdId: fixedDeposit._id,
      fdNumber: fixedDeposit.fdNumber,
      formattedFdNumber: fixedDeposit.formattedFdNumber,
      principalAmount: fixedDeposit.principalAmount,
      interestRate: fixedDeposit.interestRate,
      tenure: fixedDeposit.tenure,
      maturityAmount: fixedDeposit.maturityAmount,
      startDate: fixedDeposit.startDate,
      maturityDate: fixedDeposit.maturityDate,
      status: fixedDeposit.status,
      interestPayoutMode: fixedDeposit.interestPayoutMode,
      nominee: fixedDeposit.nominee,
      transactionId: transaction.transactionId,
      createdAt: fixedDeposit.createdAt,
    };

    res.status(201).json({
      success: true,
      message: "Fixed Deposit created successfully",
      data: fdData,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Create FD error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create Fixed Deposit",
    });
  } finally {
    session.endSession();
  }
};

// Get user's Fixed Deposits
export const getUserFixedDeposits = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { userId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const fixedDeposits = await FixedDeposit.find(query)
      .populate("fromAccountId", "accountNumber accountType")
      .populate("payoutAccountId", "accountNumber accountType")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalFDs = await FixedDeposit.countDocuments(query);

    const fdData = fixedDeposits.map((fd) => ({
      fdId: fd._id,
      fdNumber: fd.fdNumber,
      formattedFdNumber: fd.formattedFdNumber,
      principalAmount: fd.principalAmount,
      interestRate: fd.interestRate,
      tenure: fd.tenure,
      maturityAmount: fd.maturityAmount,
      startDate: fd.startDate,
      maturityDate: fd.maturityDate,
      status: fd.status,
      daysRemaining: fd.daysRemaining,
      totalInterestEarned: fd.totalInterestEarned,
      currentValue: fd.currentValue,
      interestPayoutMode: fd.interestPayoutMode,
      totalInterestPaid: fd.totalInterestPaid,
      fromAccount: fd.fromAccountId?.accountNumber,
      payoutAccount: fd.payoutAccountId?.accountNumber,
      createdAt: fd.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        fixedDeposits: fdData,
        pagination: {
          currentPage: parseInt(page),
          limit: parseInt(limit),
          totalFDs,
          totalPages: Math.ceil(totalFDs / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error("Get FDs error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Fixed Deposits",
    });
  }
};

// Get Fixed Deposit details
export const getFixedDepositDetails = async (req, res) => {
  try {
    const { fdNumber } = req.params;
    const userId = req.user.userId;

    const fixedDeposit = await FixedDeposit.findOne({
      fdNumber,
      userId,
    })
      .populate("userId", "firstName lastName email phone")
      .populate("fromAccountId", "accountNumber accountType")
      .populate("payoutAccountId", "accountNumber accountType");

    if (!fixedDeposit) {
      return res.status(404).json({
        success: false,
        message: "Fixed Deposit not found",
      });
    }

    const fdData = {
      fdId: fixedDeposit._id,
      fdNumber: fixedDeposit.fdNumber,
      formattedFdNumber: fixedDeposit.formattedFdNumber,
      principalAmount: fixedDeposit.principalAmount,
      formattedPrincipalAmount: fixedDeposit.formattedPrincipalAmount,
      interestRate: fixedDeposit.interestRate,
      tenure: fixedDeposit.tenure,
      maturityAmount: fixedDeposit.maturityAmount,
      formattedMaturityAmount: fixedDeposit.formattedMaturityAmount,
      startDate: fixedDeposit.startDate,
      maturityDate: fixedDeposit.maturityDate,
      status: fixedDeposit.status,
      daysRemaining: fixedDeposit.daysRemaining,
      totalInterestEarned: fixedDeposit.totalInterestEarned,
      currentValue: fixedDeposit.currentValue,
      interestPayoutMode: fixedDeposit.interestPayoutMode,
      totalInterestPaid: fixedDeposit.totalInterestPaid,
      lastInterestPayoutDate: fixedDeposit.lastInterestPayoutDate,
      nominee: fixedDeposit.nominee,
      fromAccount: {
        accountNumber: fixedDeposit.fromAccountId.accountNumber,
        accountType: fixedDeposit.fromAccountId.accountType,
      },
      payoutAccount: fixedDeposit.payoutAccountId
        ? {
            accountNumber: fixedDeposit.payoutAccountId.accountNumber,
            accountType: fixedDeposit.payoutAccountId.accountType,
          }
        : null,
      prematureClosureDetails: fixedDeposit.prematureClosureDetails,
      maturityDetails: fixedDeposit.maturityDetails,
      createdAt: fixedDeposit.createdAt,
      updatedAt: fixedDeposit.updatedAt,
    };

    res.status(200).json({
      success: true,
      data: fdData,
    });
  } catch (error) {
    console.error("Get FD details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Fixed Deposit details",
    });
  }
};

// Close Fixed Deposit prematurely
export const closeFixedDeposit = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { fdNumber } = req.params;
    const { reason = "Customer request" } = req.body;
    const userId = req.user.userId;

    const fixedDeposit = await FixedDeposit.findOne({
      fdNumber,
      userId,
      status: "active",
    }).session(session);

    if (!fixedDeposit) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Active Fixed Deposit not found",
      });
    }

    // Check if FD can be closed prematurely (usually after 6 months)
    const daysSinceStart = Math.floor(
      (new Date() - fixedDeposit.startDate) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceStart < 180) {
      // 6 months
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "FD can only be closed after 6 months from start date",
      });
    }

    // Process premature closure
    const result = await fixedDeposit.closePremature(reason);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Fixed Deposit closed successfully",
      data: {
        fdNumber: fixedDeposit.fdNumber,
        principalAmount: fixedDeposit.principalAmount,
        netAmount: result.netAmount,
        penaltyAmount: result.penaltyAmount,
        transactionId: result.transactionId,
        closureDate: new Date(),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Close FD error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to close Fixed Deposit",
    });
  } finally {
    session.endSession();
  }
};

// Process interest payout (manual trigger)
export const processInterestPayout = async (req, res) => {
  try {
    const { fdNumber } = req.params;
    const userId = req.user.userId;

    const fixedDeposit = await FixedDeposit.findOne({
      fdNumber,
      userId,
      status: "active",
    });

    if (!fixedDeposit) {
      return res.status(404).json({
        success: false,
        message: "Active Fixed Deposit not found",
      });
    }

    if (fixedDeposit.interestPayoutMode === "cumulative") {
      return res.status(400).json({
        success: false,
        message: "Interest payout not applicable for cumulative FDs",
      });
    }

    const result = await fixedDeposit.processInterestPayout();

    if (result.success) {
      res.status(200).json({
        success: true,
        message: "Interest payout processed successfully",
        data: {
          fdNumber: fixedDeposit.fdNumber,
          interestAmount: result.interestAmount,
          transactionId: result.transactionId,
          payoutDate: new Date(),
        },
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Process interest payout error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process interest payout",
    });
  }
};

// Get FD analytics
export const getFDAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;

    const analytics = await FixedDeposit.getAnalytics(userId);

    // Get total investment summary
    const totalFDs = await FixedDeposit.find({ userId });
    const totalInvestment = totalFDs.reduce(
      (sum, fd) => sum + fd.principalAmount,
      0
    );
    const totalMaturityValue = totalFDs.reduce(
      (sum, fd) => sum + fd.maturityAmount,
      0
    );
    const activeFDs = totalFDs.filter((fd) => fd.status === "active");

    const summary = {
      totalFDs: totalFDs.length,
      activeFDs: activeFDs.length,
      totalInvestment,
      totalMaturityValue,
      expectedReturns: totalMaturityValue - totalInvestment,
      avgInterestRate:
        activeFDs.length > 0
          ? activeFDs.reduce((sum, fd) => sum + fd.interestRate, 0) /
            activeFDs.length
          : 0,
    };

    res.status(200).json({
      success: true,
      data: {
        summary,
        analytics,
      },
    });
  } catch (error) {
    console.error("Get FD analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch FD analytics",
    });
  }
};
