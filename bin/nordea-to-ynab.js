const puppeteer = require('puppeteer')
const ynab = require('ynab')
const adapter = require('../lib/nordea')

const { 
  getSourceTransactions, 
  filterTransactionsSinceStartDate, 
  filterTransactionsNotSent, 
  buildYnabPayload 
} = adapter

let browser

async function main() {
  try {

    const { personNumber, accessToken, budgetId, accountId, startDate, allowSendAsCleared } = getRequiredArgs(process.argv);
    const ynabApi = new ynab.API(accessToken)

    browser = await puppeteer.launch({ headless: true })
    console.log('>>> Open BankID and authorise (30s to timeout)')

    const sourceTransactions = await getSourceTransactions(browser, personNumber)
    console.log(`${sourceTransactions.length} found in total`)

    const fromStartDateTransactions = await filterTransactionsSinceStartDate(sourceTransactions, startDate)
    console.log(`${fromStartDateTransactions.length} newer than ${startDate}`)
    
    const filteredTransactions = await filterTransactionsNotSent(ynabApi, fromStartDateTransactions, budgetId, accountId)
    console.log(`${filteredTransactions.length} not yet sent`)

    const ynabPayload = await buildYnabPayload(filteredTransactions, accountId, allowSendAsCleared)
    console.log(filteredTransactions)

    // await ynabApi.transactions.bulkCreateTransactions(budgetId, ynabPayload)
    console.log(`Added ${ynabPayload.transactions.length} transactions to YNAB`)
    
  } catch (error) {

    console.error(error.stack)

  } finally {

    if (browser) await browser.close()
  }
}

function getRequiredArgs(args) {
    const personNumber = args[2]
    const accessToken = args[3]
    const budgetId = args[4]
    const accountId = args[5]
    const startDate = args[6]
    const allowSendAsCleared = !!args[7]

    if (!personNumber || !accessToken || !budgetId || !accountId || !startDate) throw new Error(helpMessage())

    return { personNumber, accessToken, budgetId, accountId, startDate, allowSendAsCleared };
}

function helpMessage() {
  return 'Usage: node nordea-to-ynab.js <12-digit personummer> <Ynab Access Token> <Ynab Budget Id> <Ynab Account Id> <Date since in YYYY-MM-DD> (More info here: https://api.youneedabudget.com/)'
}

async function addTransactionsToYnab(transactions, budgetId) {
  try {
    await ynabApi.transactions.bulkCreateTransactions(budgetId, transactions)
    console.log(`Added ${transactions.transactions.length} transactions to YNAB`)
  } catch (error) {
    console.error(error.stack)
  }
}

try {
  main()
} catch (error) {
  console.error(error.message)
}

