import mongoose from "mongoose";
const accountSchema = new mongoose.Schema(
  {
    accountNumber: {
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
    accountType: {
      type: String,
      enum: ["savings", "current"],
      required: [true, "Account type is required"],
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, "Balance cannot be negative"],
      validate: {
        validator: function (value) {
          // For savings account, check minimum balance
          if (this.accountType === "savings") {
            return value >= this.minimumBalance;
          }
          // Current accounts can have negative balance up to overdraft limit
          if (this.accountType === "current") {
            return value >= -this.overdraftLimit;
          }
          return true;
        },
        message: "Balance is below minimum required balance",
      },
    },
    minimumBalance: {
      type: Number,
      default: function () {
        return this.accountType === "savings" ? 1000 : 0;
      },
    },
    overdraftLimit: {
      type: Number,
      default: function () {
        return this.accountType === "current" ? 50000 : 0;
      },
    },
    interestRate: {
      type: Number,
      default: function () {
        return this.accountType === "savings" ? 4.0 : 0;
      },
      min: [0, "Interest rate cannot be negative"],
      max: [20, "Interest rate cannot exceed 20%"],
    },
    lastInterestCalculated: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    freezeReason: {
      type: String,
      enum: [
        "none",
        "suspicious_activity",
        "customer_request",
        "admin_action",
        "legal_hold",
      ],
      default: "none",
    },
    dailyTransactionLimit: {
      type: Number,
      default: function () {
        return this.accountType === "savings" ? 50000 : 100000;
      },
    },
    monthlyTransactionLimit: {
      type: Number,
      default: function () {
        return this.accountType === "savings" ? 500000 : 1000000;
      },
    },
    todayTransactionAmount: {
      type: Number,
      default: 0,
    },
    monthTransactionAmount: {
      type: Number,
      default: 0,
    },
    lastTransactionReset: {
      type: Date,
      default: Date.now,
    },
    lastMonthlyReset: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for available balance (considering overdraft for current accounts)
accountSchema.virtual("availableBalance").get(function () {
  if (this.accountType === "current") {
    return this.balance + this.overdraftLimit;
  }
  return this.balance;
});

// Virtual for formatted account number
accountSchema.virtual("formattedAccountNumber").get(function () {
  const num = this.accountNumber;
  return `${num.substring(0, 4)} ${num.substring(4, 8)} ${num.substring(8)}`;
});

// Virtual for account status
accountSchema.virtual("status").get(function () {
  if (!this.isActive) return "inactive";
  if (this.freezeReason !== "none") return "frozen";
  return "active";
});

// Indexes for better performance
accountSchema.index({ userId: 1, accountType: 1 });
accountSchema.index({ accountNumber: 1 });
accountSchema.index({ isActive: 1, accountType: 1 });

// Pre-save middleware to generate account number
accountSchema.pre("save", async function (next) {
  if (this.isNew && !this.accountNumber) {
    this.accountNumber = await generateAccountNumber(this.accountType);
  }
  next();
});

// Static method to generate unique account number
async function generateAccountNumber(accountType) {
  const prefix = accountType === "savings" ? "100" : "200";
  let isUnique = false;
  let accountNumber;

  while (!isUnique) {
    const randomDigits = Math.floor(Math.random() * 10000000)
      .toString()
      .padStart(7, "0");
    accountNumber = prefix + randomDigits;

    const existingAccount = await mongoose
      .model("Account")
      .findOne({ accountNumber });
    if (!existingAccount) {
      isUnique = true;
    }
  }

  return accountNumber;
}

// Method to check if transaction is within limits
accountSchema.methods.canTransact = function (amount) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Reset daily limit if it's a new day
  if (this.lastTransactionReset < today) {
    this.todayTransactionAmount = 0;
    this.lastTransactionReset = now;
  }

  // Reset monthly limit if it's a new month
  if (this.lastMonthlyReset < thisMonth) {
    this.monthTransactionAmount = 0;
    this.lastMonthlyReset = now;
  }

  // Check daily limit
  if (this.todayTransactionAmount + amount > this.dailyTransactionLimit) {
    return {
      allowed: false,
      reason: "Daily transaction limit exceeded",
    };
  }

  // Check monthly limit
  if (this.monthTransactionAmount + amount > this.monthlyTransactionLimit) {
    return {
      allowed: false,
      reason: "Monthly transaction limit exceeded",
    };
  }

  // Check if account has sufficient balance (including overdraft for current accounts)
  if (this.accountType === "savings") {
    if (this.balance - amount < this.minimumBalance) {
      return {
        allowed: false,
        reason: "Insufficient balance. Minimum balance requirement not met",
      };
    }
  } else if (this.accountType === "current") {
    if (this.balance - amount < -this.overdraftLimit) {
      return {
        allowed: false,
        reason: "Overdraft limit exceeded",
      };
    }
  }

  return {
    allowed: true,
    reason: null,
  };
};

// Method to update transaction amounts after successful transaction
accountSchema.methods.updateTransactionAmounts = function (amount) {
  this.todayTransactionAmount += amount;
  this.monthTransactionAmount += amount;
  return this.save();
};

// Method to credit account
accountSchema.methods.credit = async function (amount, description = "Credit") {
  if (amount <= 0) {
    throw new Error("Credit amount must be positive");
  }

  this.balance += amount;
  await this.save();

  return {
    success: true,
    newBalance: this.balance,
    message: `Account credited with ₹${amount.toLocaleString("en-IN")}`,
  };
};

// Method to debit account with checks
accountSchema.methods.debit = async function (amount, description = "Debit") {
  if (amount <= 0) {
    throw new Error("Debit amount must be positive");
  }

  // Check if transaction is allowed
  const canTransact = this.canTransact(amount);
  if (!canTransact.allowed) {
    throw new Error(canTransact.reason);
  }

  this.balance -= amount;
  await this.updateTransactionAmounts(amount);

  return {
    success: true,
    newBalance: this.balance,
    message: `Account debited with ₹${amount.toLocaleString("en-IN")}`,
  };
};

// Method to freeze account
accountSchema.methods.freeze = function (reason = "admin_action") {
  this.freezeReason = reason;
  this.isActive = false;
  return this.save();
};

// Method to unfreeze account
accountSchema.methods.unfreeze = function () {
  this.freezeReason = "none";
  this.isActive = true;
  return this.save();
};

// Static method to find accounts by user
accountSchema.statics.findByUser = function (userId) {
  return this.find({ userId, isActive: true }).populate(
    "userId",
    "firstName lastName email"
  );
};

// Static method to find account by account number
accountSchema.statics.findByAccountNumber = function (accountNumber) {
  return this.findOne({ accountNumber, isActive: true }).populate(
    "userId",
    "firstName lastName email"
  );
};

// Static method to calculate interest for savings accounts
accountSchema.statics.calculateInterestForAllSavingsAccounts =
  async function () {
    const savingsAccounts = await this.find({
      accountType: "savings",
      isActive: true,
      balance: { $gt: 0 },
    });

    const results = [];

    for (const account of savingsAccounts) {
      const daysSinceLastCalculation = Math.floor(
        (new Date() - account.lastInterestCalculated) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastCalculation >= 30) {
        // Calculate monthly
        const monthlyInterest =
          (account.balance * account.interestRate) / (12 * 100);

        account.balance += monthlyInterest;
        account.lastInterestCalculated = new Date();
        await account.save();

        results.push({
          accountNumber: account.accountNumber,
          interestAdded: monthlyInterest,
          newBalance: account.balance,
        });
      }
    }

    return results;
  };

export default mongoose.model("Account", accountSchema);
