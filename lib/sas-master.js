const puppeteer = require('puppeteer')

async function getSourceTransactions(browser, personNumber) {
  const initialPage = await start(browser)
  const page = await setPersonNumber(personNumber, initialPage)
  await page.goto('https://secure.sebkort.com/nis/m/sase/external/t/login/index#uninvoice')
  await page.waitForSelector('#cardTransactionContentTable')
  return await page.evaluate(extractAndFormatTransactions)
}

async function start(browser) {
  const page = await browser.newPage()
  await page.goto('https://secure.sebkort.com/nis/m/sase/external/initEidLogin?method=sbid-remote-seb', {waitUntil: 'networkidle0'})
  return page
}

async function setPersonNumber(personNumber, page) {
  const inputField = await page.$('.id-number-input')
  await inputField.focus()
  await inputField.type(personNumber)
  await inputField.press('Enter')
  await page.waitForSelector('section.overview')
  return page
}

function extractAndFormatTransactions() {
  const rows = [...document.querySelectorAll('li.reserved, li.list-item')]

  // Unfortunately, all functions needed gotta be in this block, since an page.eval
  // requires it to be this way
  const formatDate = (rawDate) => {
    const date = rawDate
    const year = new Date().getFullYear()
    const month = Number(date.split("-")[0]) - 1 // WHY GOD WHY
    const day = date.split("-")[1]
    const utcDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
    return utcDate.toJSON().toString()
  }

  return rows.map(row => {
    const allCols = [...row.querySelectorAll('ul.container li')]
    const selCols = allCols.filter((col, index) => [0, 1, 2, 6].includes(index))
    const mappedCols = selCols.map(col => col.innerText)
    const [rawDate, reserved, payee, rawAmount] = mappedCols
    const amount = rawAmount.replace(',', '.').replace('\xc2', '').replace('\xa0', '')
    const isCleared = reserved !== 'Reserverat'
    const date = formatDate(rawDate)
    return { date, isCleared, payee, amount }
  })
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

function areSameTransaction(cardTransaction, ynabTransaction) {
  if (cardTransaction.payee.toLowerCase().startsWith('betalt')) {
    return true
  }

  const cardTransactionDate = new Date(cardTransaction.date)
  const ynabTransactionDate = new Date(ynabTransaction.date)

  const hasSameDate = 
    cardTransactionDate.getMonth() === ynabTransactionDate.getMonth()
    && cardTransactionDate.getDate() === ynabTransactionDate.getDate()

  const cardTransactionAmount = -1 * parseFloat(cardTransaction.amount)
  const ynabTransactionAmount = parseFloat(ynabTransaction.amount) / 1000

  // Sometimes the ynab amount has a rounding problem, so we fix by looking at the absolute differente
  const hasSameAmount = Math.abs(cardTransactionAmount - ynabTransactionAmount) < 0.001
  const hasSameName = ynabTransaction.payee_name && ynabTransaction.payee_name.toLowerCase() === cardTransaction.payee.toLowerCase()

  return hasSameDate && hasSameName && hasSameAmount
}

function buildYnabPayload(transactions, accountId, allowSendAsCleared = false) {
  return {
    'transactions': transactions.map(transaction => {
      return {
        'account_id': accountId,
        'date': new Date(transaction.date),
        // *-1 since it's an expense, *1000 to convert it to the correct unit
        'amount': Math.trunc(parseFloat(transaction.amount) * -1 * 1000),
        'payee_id': null,
        'payee_name': transaction.payee,
        'category_id': null,
        'memo': null,
        'cleared': (allowSendAsCleared && transaction.isCleared ? 'cleared' : 'uncleared'),
        'approved': false,
        'flag_color': 'orange',
        'import_id': null
      }
    })
  }
}

module.exports = {
  getSourceTransactions,
  filterTransactionsNotSent,
  buildYnabPayload,
}

