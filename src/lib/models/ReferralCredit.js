import * as auth from "../core/auth"
import assert from 'assert'
import _ from 'lodash'
import Joi from "joi"
import { TransactionBuilder } from '../transactions/builder'

export default function (modelCache) {
  var DataTypes = modelCache.db.Sequelize
  var db = modelCache.db

  return modelCache.db.define('referralCredit', {
    userId: {
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    balance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: '0.00',
    }
  },
    {
      classMethods: {
        get (userId, options) {
          return this.findOrCreate(_.defaults({
            raw: true,
            where: {userId},
            defaults: {userId}
          }, options))
          .then(([inst, isCreated]) => inst)
        },
        getReferralCredits (userId, options) {
          return this.findOrCreate(_.defaults({
            raw: true,
            where: {userId},
            defaults: {userId},
          }, options))
          .then(([inst, isCreated]) => inst.balance)
        },
        addReferralCredits (userId, amount, options) {
          assert(isFinite(userId))
          assert(isFinite(amount))

          return this.findOrCreate(_.defaults({
            defaults: {userId: userId, balance: 0.0},
            where: {userId: userId},
          }, options)).then(([inst, isCreated]) => {
            assert(parseFloat(inst.balance) >= -parseFloat(amount))
            return inst.increment('balance', _.defaults({by: amount}, options))
          })
        },
        subtractReferralCredits (userId, amount, options) {
          assert(isFinite(userId))
          assert(isFinite(amount))

          return this.findById(userId, options)
          .then(inst => {
            assert(parseFloat(inst.balance) + 0.0001 >= parseFloat(amount))
            return inst.decrement('balance', _.defaults({by: amount}, options))
          })
        },
      // Method handling operations between a user referral credit account and
      // the main "Cost of Goods Sold" account. Creates transaction
      // and transactionItem entry.
      // from: {itemType: 'account' or 'referralCredits', itemId: accountId or userId respectively}
      // to: {itemType: 'account' or 'referralCredits', itemId: accountId or userId respectively}
      // amount: amount to add or deduct
      // tb: transactionBuilder - {db, transaction, models, dryRun, committed, description, transactionItemsByType}
      // Returns tb object with transactionItems describing the distribution of credits
      //
      // referralCredit accounts are considered liability accounts (credit)
      // credits are drawn from our expense account (debit)
        async moveCredits (from, to, amount, tb) {
        // check input
          Joi.assert(from, Joi.object().keys({
            itemType: Joi.string().required().valid(['account', 'referralCredits']),
            itemId: Joi.number().integer().required()
          }))
          Joi.assert(to, Joi.object().keys({
            itemType: Joi.string().required().valid(['account', 'referralCredits']),
            itemId: Joi.number().integer().required()
          }))
          Joi.assert(amount, Joi.number().required())
          Joi.assert(tb, Joi.object())

          let clone = new TransactionBuilder(tb)
          clone.transactionItemsByType.referralCredits = clone.transactionItemsByType.referralCredits || []
          clone.transactionItemsByType.account = clone.transactionItemsByType.account || []

          let fromTransactionItem = _.defaults({debit: amount}, from)
          let toTransactionItem = _.defaults({credit: amount}, to)

          if (fromTransactionItem.itemType === 'referralCredits') {
            await this.subtractReferralCredits(fromTransactionItem.itemId, amount, { transaction: clone.transaction })
            clone.transactionItemsByType.referralCredits.push(fromTransactionItem)
            clone.transactionItemsByType.account.push(toTransactionItem)
          }
          if (toTransactionItem.itemType === 'referralCredits') {
            await this.addReferralCredits(to.itemId, amount, { transaction: clone.transaction })
            clone.transactionItemsByType.referralCredits.push(toTransactionItem)
            clone.transactionItemsByType.account.push(fromTransactionItem)
          }

          return clone
        }
      },
    })
}

export function makeAssociation (modelCache) {
  var ReferralCredit = modelCache.require('ReferralCredit')
  var TransactionItem = modelCache.require('TransactionItem')
  var User = modelCache.require('User')

  ReferralCredit.hasMany(TransactionItem, {
    foreignKey: "itemId",
    constraints: false,
    scope: {
      itemType: {
        $in: ["referralCredits"]
      }
    }
  })

  ReferralCredit.belongsTo(User, {
    foreignKey: "userId"
  })
}
