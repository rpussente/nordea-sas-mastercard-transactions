const express = require('express')
const puppeteer = require('puppeteer')
const bodyParser = require('body-parser')
const port = process.env.PORT || 5000

express()
  .use(bodyParser.json())
  .get('/', (req, res) => res.send('Tjena!'))
  .post('/transactions', sendTransactionsToYnab)
  .listen(port, () => console.log(`Running on port ${port}`))

async function sendTransactionsToYnab(req, res) {
  const chosenAdapter = req.body.adapter
  const personNumber = req.body.personNumber

  if (['sas-master', 'nordea'].indexOf(chosenAdapter) < 0) {
    res.status(400).end()
    return
  }

  if (!personNumber) {
    res.status(400).end()
    return
  }

  const adapter = require(`../lib/${chosenAdapter}`)
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const sourceTransactions = await adapter.getSourceTransactions(browser, personNumber)
  browser.close()

  res.send(sourceTransactions)
}
