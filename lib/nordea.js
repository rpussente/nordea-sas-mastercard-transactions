const puppeteer = require('puppeteer')

async function getSourceTransactions(browser, personNumber) {
  const initialPage = await start(browser)
  const page = await setPersonNumber(personNumber, initialPage)
  const link = await page.evaluate(() => document.querySelector('#currentaccountsoverviewtable a').href)
  await page.goto(link)
  return await page.evaluate(extractAndFormatTransactions)
}

async function start(browser) {
  const page = await browser.newPage()
  await page.goto('https://internetbanken.privat.nordea.se/nsp/login')
  return page
}

async function setPersonNumber(personNumber, page) {
  const inputField = await page.$('#personnummer')
  await inputField.focus()
  await inputField.type(personNumber)
  await inputField.press('Enter')
  await page.waitForSelector('#currentaccountsoverviewtable a')
  return page
}

function extractAndFormatTransactions() {
  const allRows = [...document.querySelectorAll('#transactionstable tr')]
  const rows = allRows.filter(row => row.querySelectorAll('td').length > 1)

  // Unfortunately, all functions needed gotta be in this block, since an page.eval
  // requires it to be this way
  const formatDate = (rawDate) => {
    const date = rawDate.split("-")
    const year = new Date().getFullYear()
    const month = Number(date[1]) - 1 // WHY GOD WHY
    const day = date[2]
    const utcDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
    return utcDate.toJSON().toString()
  }

  return rows.map(row => {
    const allCols = [...row.querySelectorAll('td')]
    const selCols = allCols.filter((col, index) => [1, 2, 4].includes(index))
    const mappedCols = selCols.map(col => col.innerText)
    const [rawDate, payee, rawAmount] = mappedCols
    const amount = rawAmount.replace('.', '').replace(',', '.').replace('\xc2', '').replace('\xa0', '')
    const isCleared = true;
    const date = formatDate(rawDate)
    return { date, isCleared, payee, amount }
  })
}

function filterTransactionsSinceStartDate(transactions, startDate) {
  return transactions.filter(transaction => new Date(transaction.date) >= new Date(startDate))
}

async function filterTransactionsNotSent(ynabApi, transactions, budgetId, accountId) {
  const earliestDateUtc = transactions.reduce(getEarliestDate, new Date())
  const earliestFullDate = earliestDateUtc.substring(0, earliestDateUtc.indexOf('T'))

  const ynabTransactions = await getYnabTransactions(ynabApi, budgetId, accountId, earliestFullDate)
  return transactions.filter(transaction => !isTransactionAlreadyInYnab(transaction, ynabTransactions))
}

function getEarliestDate(earliest, tx) {
  return new Date(earliest) < new Date(tx.date) ? earliest : tx.date
}

async function getYnabTransactions(ynabApi, budgetId, accountId, earliestDate) {
  const transactions = await ynabApi.transactions.getTransactionsByAccount(budgetId, accountId, earliestDate)
  return transactions.data.transactions
}

function isTransactionAlreadyInYnab(transaction, ynabTransactions) {
  return ynabTransactions.some(ynabTransaction => areSameTransaction(transaction, ynabTransaction))
}

function areSameTransaction(bankTransaction, ynabTransaction) {
  const bankTransactionDate = new Date(bankTransaction.date)
  const ynabTransactionDate = new Date(ynabTransaction.date)

  const hasSameDate = 
    bankTransactionDate.getMonth() === ynabTransactionDate.getMonth()
    && bankTransactionDate.getDate() === ynabTransactionDate.getDate()

  const bankTransactionAmount = parseFloat(bankTransaction.amount)
  const ynabTransactionAmount = parseFloat(ynabTransaction.amount) / 1000

  // Sometimes the ynab amount has a rounding problem, so we fix by looking at the absolute differente
  const hasSameAmount = Math.abs(bankTransactionAmount - ynabTransactionAmount) < 0.001
  const hasSameName = ynabTransaction.payee_name && ynabTransaction.payee_name.toLowerCase() === bankTransaction.payee.toLowerCase()

  return hasSameDate && hasSameName && hasSameAmount
}

function buildYnabPayload(transactions, accountId, allowSendAsCleared = false) {
  return {
    'transactions': transactions.map(transaction => {
      return {
        'account_id': accountId,
        'date': new Date(transaction.date),
        // *1000 to convert it to the YNAB unit
        'amount': Math.trunc(parseFloat(transaction.amount) * 1000),
        'payee_id': null,
        'payee_name': transaction.payee,
        'category_id': null,
        'memo': null,
        'cleared': (allowSendAsCleared && transaction.isCleared ? 'cleared' : 'uncleared'),
        'approved': false,
        'flag_color': 'blue',
        'import_id': null
      }
    })
  }
}

module.exports = {
  getSourceTransactions,
  filterTransactionsSinceStartDate, 
  filterTransactionsNotSent,
  buildYnabPayload,
}

