const mongoose = require("mongoose");

const fixedDepositSchema = new mongoose.Schema(
  {
    fdNumber: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    fromAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: [true, "Source account is required"],
      index: true,
    },
    principalAmount: {
      type: Number,
      required: [true, "Principal amount is required"],
      min: [1000, "Minimum FD amount is ₹1,000"],
      max: [10000000, "Maximum FD amount is ₹1,00,00,000"],
      validate: {
        validator: function (value) {
          return Number.isFinite(value) && value >= 1000;
        },
        message: "Principal amount must be at least ₹1,000",
      },
    },
    interestRate: {
      type: Number,
      required: [true, "Interest rate is required"],
      min: [1, "Interest rate must be at least 1%"],
      max: [15, "Interest rate cannot exceed 15%"],
    },
    tenure: {
      type: Number,
      required: [true, "Tenure is required"],
      min: [6, "Minimum tenure is 6 months"],
      max: [120, "Maximum tenure is 120 months (10 years)"],
    },
    tenureType: {
      type: String,
      enum: ["months"],
      default: "months",
    },
    maturityAmount: {
      type: Number,
      required: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    maturityDate: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "matured", "closed", "premature_closed"],
      default: "active",
      index: true,
    },
    isAutoRenewal: {
      type: Boolean,
      default: false,
    },
    renewalCount: {
      type: Number,
      default: 0,
    },
    nominee: {
      name: {
        type: String,
        required: [true, "Nominee name is required"],
        trim: true,
      },
      relationship: {
        type: String,
        required: [true, "Nominee relationship is required"],
        enum: [
          "spouse",
          "son",
          "daughter",
          "father",
          "mother",
          "brother",
          "sister",
          "other",
        ],
      },
      dateOfBirth: Date,
      share: {
        type: Number,
        default: 100,
        min: [1, "Nominee share must be at least 1%"],
        max: [100, "Nominee share cannot exceed 100%"],
      },
    },
    interestPayoutMode: {
      type: String,
      enum: ["cumulative", "monthly", "quarterly", "half_yearly", "yearly"],
      default: "cumulative",
    },
    payoutAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null, // If null, interest will be compounded
    },
    totalInterestPaid: {
      type: Number,
      default: 0,
    },
    lastInterestPayoutDate: {
      type: Date,
      default: null,
    },
    prematureClosureDetails: {
      closureDate: Date,
      penaltyRate: Number,
      penaltyAmount: Number,
      netAmount: Number,
      reason: String,
    },
    maturityDetails: {
      processedDate: Date,
      creditedAccountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Account",
      },
      transactionId: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for formatted FD number
fixedDepositSchema.virtual("formattedFdNumber").get(function () {
  const num = this.fdNumber;
  return `FD-${num}`;
});

// Virtual for formatted amounts
fixedDepositSchema.virtual("formattedPrincipalAmount").get(function () {
  return `₹${this.principalAmount.toLocaleString("en-IN")}`;
});

fixedDepositSchema.virtual("formattedMaturityAmount").get(function () {
  return `₹${this.maturityAmount.toLocaleString("en-IN")}`;
});

// Virtual for days remaining
fixedDepositSchema.virtual("daysRemaining").get(function () {
  if (this.status !== "active") return 0;
  const now = new Date();
  const maturity = new Date(this.maturityDate);
  const diffTime = maturity - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
});

// Virtual for total interest earned
fixedDepositSchema.virtual("totalInterestEarned").get(function () {
  return this.maturityAmount - this.principalAmount;
});

// Virtual for current value (for premature closure calculation)
fixedDepositSchema.virtual("currentValue").get(function () {
  if (this.status !== "active") return this.principalAmount;

  const now = new Date();
  const startDate = new Date(this.startDate);
  const maturityDate = new Date(this.maturityDate);

  // Calculate completed months
  const totalTenure = this.tenure;
  const totalDays = maturityDate - startDate;
  const daysCompleted = now - startDate;
  const completedTenure = (daysCompleted / totalDays) * totalTenure;

  // Apply penalty rate for premature closure (usually 1% less than original rate)
  const penaltyRate = Math.max(this.interestRate - 1, 0);

  // Calculate compound interest for completed tenure
  const ratePerMonth = penaltyRate / (12 * 100);
  const currentValue =
    this.principalAmount * Math.pow(1 + ratePerMonth, completedTenure);

  return Math.round(currentValue);
});

// Indexes
fixedDepositSchema.index({ userId: 1, status: 1 });
fixedDepositSchema.index({ maturityDate: 1, status: 1 });
fixedDepositSchema.index({ startDate: 1 });

// Pre-save middleware
fixedDepositSchema.pre("save", async function (next) {
  if (this.isNew) {
    // Generate FD number
    if (!this.fdNumber) {
      this.fdNumber = await generateFDNumber();
    }

    // Calculate maturity date
    if (!this.maturityDate) {
      const startDate = new Date(this.startDate);
      const maturityDate = new Date(startDate);
      maturityDate.setMonth(maturityDate.getMonth() + this.tenure);
      this.maturityDate = maturityDate;
    }

    // Calculate maturity amount
    if (
      !this.maturityAmount ||
      this.isModified("principalAmount") ||
      this.isModified("interestRate") ||
      this.isModified("tenure")
    ) {
      this.maturityAmount = calculateMaturityAmount(
        this.principalAmount,
        this.interestRate,
        this.tenure,
        this.interestPayoutMode
      );
    }
  }

  next();
});

// Generate unique FD number
async function generateFDNumber() {
  const year = new Date().getFullYear();
  let isUnique = false;
  let fdNumber;

  while (!isUnique) {
    const randomDigits = Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0");
    fdNumber = `${year}${randomDigits}`;

    const existingFD = await mongoose
      .model("FixedDeposit")
      .findOne({ fdNumber });
    if (!existingFD) {
      isUnique = true;
    }
  }

  return fdNumber;
}

// Calculate maturity amount based on interest payout mode
function calculateMaturityAmount(principal, rate, tenure, payoutMode) {
  const monthlyRate = rate / (12 * 100);

  if (payoutMode === "cumulative") {
    // Compound interest monthly
    return Math.round(principal * Math.pow(1 + monthlyRate, tenure));
  } else {
    // Simple interest (principal remains same, only interest is paid out)
    return principal;
  }
}

// Method to calculate current interest
fixedDepositSchema.methods.calculateCurrentInterest = function () {
  const now = new Date();
  const startDate = new Date(this.startDate);
  const monthsCompleted = Math.floor(
    (now - startDate) / (1000 * 60 * 60 * 24 * 30.44)
  ); // Average days in a month

  if (this.interestPayoutMode === "cumulative") {
    const monthlyRate = this.interestRate / (12 * 100);
    const currentAmount =
      this.principalAmount * Math.pow(1 + monthlyRate, monthsCompleted);
    return Math.round(currentAmount - this.principalAmount);
  } else {
    const monthlyInterest =
      (this.principalAmount * this.interestRate) / (12 * 100);
    return Math.round(monthlyInterest * monthsCompleted);
  }
};

// Method to process interest payout
fixedDepositSchema.methods.processInterestPayout = async function () {
  if (this.interestPayoutMode === "cumulative" || !this.payoutAccountId) {
    throw new Error("Interest payout not applicable for this FD");
  }

  const now = new Date();
  const lastPayoutDate = this.lastInterestPayoutDate || this.startDate;

  let payoutPeriod;
  switch (this.interestPayoutMode) {
    case "monthly":
      payoutPeriod = 1;
      break;
    case "quarterly":
      payoutPeriod = 3;
      break;
    case "half_yearly":
      payoutPeriod = 6;
      break;
    case "yearly":
      payoutPeriod = 12;
      break;
    default:
      throw new Error("Invalid interest payout mode");
  }

  const monthsSinceLastPayout = Math.floor(
    (now - lastPayoutDate) / (1000 * 60 * 60 * 24 * 30.44)
  );

  if (monthsSinceLastPayout >= payoutPeriod) {
    const interestAmount =
      (this.principalAmount * this.interestRate * payoutPeriod) / (12 * 100);

    // Credit interest to payout account
    const Account = mongoose.model("Account");
    const Transaction = mongoose.model("Transaction");

    const payoutAccount = await Account.findById(this.payoutAccountId);
    if (!payoutAccount) {
      throw new Error("Payout account not found");
    }

    // Create transaction
    const transaction = new Transaction({
      toAccountId: this.payoutAccountId,
      toAccountNumber: payoutAccount.accountNumber,
      amount: interestAmount,
      transactionType: "interest_credit",
      description: `FD Interest payout for ${this.formattedFdNumber}`,
      reference: this.fdNumber,
      status: "completed",
      processedAt: new Date(),
    });

    await transaction.save();

    // Credit account
    await payoutAccount.credit(
      interestAmount,
      `FD Interest - ${this.fdNumber}`
    );

    // Update FD record
    this.totalInterestPaid += interestAmount;
    this.lastInterestPayoutDate = now;
    await this.save();

    return {
      success: true,
      interestAmount,
      transactionId: transaction.transactionId,
    };
  }

  return {
    success: false,
    message: "Interest payout not due yet",
  };
};

// Method to close FD prematurely
fixedDepositSchema.methods.closePremature = async function (
  reason = "Customer request"
) {
  if (this.status !== "active") {
    throw new Error("FD is not active");
  }

  const now = new Date();
  const penaltyRate = 1; // 1% penalty
  const currentValue = this.currentValue;
  const penaltyAmount = Math.round((currentValue * penaltyRate) / 100);
  const netAmount = currentValue - penaltyAmount;

  // Create transaction to credit the net amount
  const Account = mongoose.model("Account");
  const Transaction = mongoose.model("Transaction");

  const fromAccount = await Account.findById(this.fromAccountId);
  if (!fromAccount) {
    throw new Error("Source account not found");
  }

  const transaction = new Transaction({
    toAccountId: this.fromAccountId,
    toAccountNumber: fromAccount.accountNumber,
    amount: netAmount,
    transactionType: "fd_maturity",
    description: `Premature closure of ${this.formattedFdNumber}`,
    reference: this.fdNumber,
    status: "completed",
    processedAt: now,
  });

  await transaction.save();

  // Credit account
  await fromAccount.credit(
    netAmount,
    `FD Premature Closure - ${this.fdNumber}`
  );

  // Update FD status
  this.status = "premature_closed";
  this.prematureClosureDetails = {
    closureDate: now,
    penaltyRate,
    penaltyAmount,
    netAmount,
    reason,
  };

  await this.save();

  return {
    success: true,
    netAmount,
    penaltyAmount,
    transactionId: transaction.transactionId,
  };
};

// Method to process maturity
fixedDepositSchema.methods.processMaturity = async function () {
  if (this.status !== "active") {
    throw new Error("FD is not active");
  }

  const now = new Date();
  if (now < this.maturityDate) {
    throw new Error("FD has not reached maturity date");
  }

  // Create transaction to credit maturity amount
  const Account = mongoose.model("Account");
  const Transaction = mongoose.model("Transaction");

  const fromAccount = await Account.findById(this.fromAccountId);
  if (!fromAccount) {
    throw new Error("Source account not found");
  }

  const transaction = new Transaction({
    toAccountId: this.fromAccountId,
    toAccountNumber: fromAccount.accountNumber,
    amount: this.maturityAmount,
    transactionType: "fd_maturity",
    description: `Maturity of ${this.formattedFdNumber}`,
    reference: this.fdNumber,
    status: "completed",
    processedAt: now,
  });

  await transaction.save();

  // Credit account
  await fromAccount.credit(
    this.maturityAmount,
    `FD Maturity - ${this.fdNumber}`
  );

  // Update FD status
  this.status = "matured";
  this.maturityDetails = {
    processedDate: now,
    creditedAccountId: this.fromAccountId,
    transactionId: transaction.transactionId,
  };

  await this.save();

  return {
    success: true,
    maturityAmount: this.maturityAmount,
    transactionId: transaction.transactionId,
  };
};

// Static method to find FDs by user
fixedDepositSchema.statics.findByUser = function (userId, status = null) {
  const query = { userId };
  if (status) {
    query.status = status;
  }

  return this.find(query)
    .populate("userId", "firstName lastName email")
    .populate("fromAccountId", "accountNumber accountType")
    .populate("payoutAccountId", "accountNumber accountType")
    .sort({ createdAt: -1 });
};

// Static method to find maturing FDs
fixedDepositSchema.statics.findMaturing = function (days = 0) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  return this.find({
    status: "active",
    maturityDate: { $lte: targetDate },
  })
    .populate("userId", "firstName lastName email phone")
    .populate("fromAccountId", "accountNumber accountType");
};

// Static method for FD analytics
fixedDepositSchema.statics.getAnalytics = function (userId = null) {
  const matchStage = userId ? { userId: mongoose.Types.ObjectId(userId) } : {};

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalPrincipal: { $sum: "$principalAmount" },
        totalMaturityValue: { $sum: "$maturityAmount" },
        avgInterestRate: { $avg: "$interestRate" },
        avgTenure: { $avg: "$tenure" },
      },
    },
  ]);
};

module.exports = mongoose.model("FixedDeposit", fixedDepositSchema);
